import { RefreshSession } from '../../src/app/models/refresh-session.entity.js';
import { User } from '../../src/app/models/user.entity.js';
import {
  PURGE_BATCH_SQL,
  purgeExpiredRefreshSessions,
} from '../../src/app/jobs/purge-expired-refresh-sessions.js';
import { acquireCommitLock, createTestDataSource } from '../db/fixture.js';
import type { DataSource } from 'typeorm';
import type { CommitLockHandle } from '../db/fixture.js';

/**
 * `purgeExpiredRefreshSessions`의 기능 계약을 실제 PostgreSQL로 고정한다.
 *
 * **왜 `withRollback`이 아니라 커밋하는 스위트인가.** 브리프의 원래 계획은
 * `withRollback` 안에서 확인하는 것이었다 — 이 함수의 커밋이 `withRollback`의 바깥
 * 트랜잭션에 흡수될 것이라는 전제였다. 실제로 시도해 보면 그 전제가 깨진다:
 * `purgeExpiredRefreshSessions`는 `DataSource`를 받아 **자기 자신의 새 커넥션**으로
 * `createQueryRunner()`를 연다(`withRollback`이 만드는 커넥션과 다른, 풀에서 새로
 * 받은 커넥션이다). `withRollback` 안에서 만든 행은 `withRollback`의 트랜잭션
 * 안에서만 존재하고 아직 커밋되지 않았으므로, PostgreSQL의 트랜잭션 격리 규칙상
 * **다른 커넥션은 그 행을 볼 수 없다** — READ COMMITTED에서도 마찬가지다. 그 결과 이
 * 함수는 항상 `{ deleted: 0, batches: 1 }`만 돌려주고, 이 파일이 고정하려는 계약(보존
 * 기간 필터링·정렬·배치 횟수·cascade)은 하나도 검증되지 않는다 — 브리프 자신이 예견한
 * 바로 그 상황이다("DataSource를 받는 함수라 롤백 픽스처와 맞지 않으면 이 스펙 전체를
 * 커밋하는 스위트로 옮기고 그 이유를 보고하라"). 그래서 이 스위트는 처음부터 커밋하는
 * 모양으로 쓴다 — `auth-api.spec.ts`처럼 이 스위트 전용 이메일 접두사만 만들고
 * 지운다.
 *
 * **`acquireCommitLock`을 잡는다.** 이 잡은 이메일/사용자로 스코프할 수 없다 —
 * 만료된 세션을 테이블 전체에서 지운다. 그리고 이 태스크가 함께 만드는 다른 커밋
 * 스위트 `purge-refresh-sessions-contention.spec.ts`도 정확히 같은 함수를 정확히
 * 같은 방식(테이블 전체 대상)으로 부르면서, 역시 검증을 위해 `expires_at`을 의도적으로
 * 과거로 만들어 커밋한다. Jest는 스펙 파일을 병렬 워커로 돌리므로(`jest.config.js`에
 * `maxWorkers` 제한이 없다), 잠금이 없으면 이 파일의 purge 호출이 그 스위트가 만든
 * "잠긴 채로 남아 있어야 할" 행까지 지워 버리거나, 그 반대로 이 파일의 배치·삭제 수
 * 단언이 상대 스위트의 동시 삭제로 흔들릴 수 있다 — 이 잡의 삭제 대상이 이메일로
 * 좁혀지지 않는 한 접두사 분리만으로는 막을 수 없는 간섭이다. 이 잠금의 근거와
 * (기존 다섯 커밋 스위트에는 잠금이 필요 없는 이유까지 포함한) 전체 판단은
 * `purge-refresh-sessions-contention.spec.ts` 상단 주석에 적는다 — 두 파일이 같은
 * 결정을 공유하므로 그쪽에 한 번만 자세히 적고 여기서는 요약만 남긴다.
 */

const EMAIL_PREFIX = 'purge-once-';

describe('purgeExpiredRefreshSessions', () => {
  let dataSource: DataSource;
  let commitLock: CommitLockHandle;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    commitLock = await acquireCommitLock(dataSource);
  });

  afterEach(async () => {
    // `users`만 지우면 된다 — `refresh_sessions.user_id`가 `ON DELETE CASCADE`라
    // 세션도 함께 사라진다. 조건 없는 DELETE는 쓰지 않는다.
    await dataSource.query(`DELETE FROM users WHERE email LIKE '${EMAIL_PREFIX}%'`);
  });

  afterAll(async () => {
    try {
      await commitLock.release();
    } finally {
      await dataSource.destroy();
    }
  });

  /** 이 스위트 전용 사용자 하나를 만들고 id를 돌려준다. */
  async function createUser(suffix: string): Promise<string> {
    const user = await dataSource.manager.save(User, {
      email: `${EMAIL_PREFIX}${suffix}@example.test`,
      passwordHash: 'x',
      isActive: true,
    });
    return user.id;
  }

  /**
   * refresh session 하나를 원하는 만료 시각으로 직접 만든다. `issueSession`을 쓰지
   * 않는 이유: `issueSession`은 `expiresAt`을 항상 미래로만 계산하므로, 만료 필터를
   * 확인하려면 과거 시각을 직접 넣을 수 있는 이 경로가 필요하다 —
   * `refresh-session.spec.ts` 96행과 같은 이유·같은 모양이다.
   */
  async function createSession(
    userId: string,
    expiresAt: Date,
    extra: { revokedAt?: Date | null; replacedById?: string | null } = {},
  ): Promise<string> {
    const session = await dataSource.manager.save(RefreshSession, {
      userId,
      expiresAt,
      revokedAt: extra.revokedAt ?? null,
      replacedById: extra.replacedById ?? null,
    });
    return session.id;
  }

  async function exists(sessionId: string): Promise<boolean> {
    const found = await dataSource.manager.findOneBy(RefreshSession, { id: sessionId });
    return found !== null;
  }

  it('보존 기간보다 오래 만료된 행만 지운다', async () => {
    const userId = await createUser('retention');
    const now = Date.now();
    // 세 행을 한 번에 확인한다: 아직 만료 안 됨 / 만료됐지만 보존 기간 안 / 보존
    // 기간을 지나 만료.
    const notExpiredId = await createSession(userId, new Date(now + 3_600_000));
    const withinRetentionId = await createSession(userId, new Date(now - 10_000));
    const beyondRetentionId = await createSession(userId, new Date(now - 120_000));

    const result = await purgeExpiredRefreshSessions(dataSource, {
      retentionSeconds: 60,
      batchSize: 10,
      lockTimeoutMs: 500,
    });

    expect(result.deleted).toBe(1);
    await expect(exists(beyondRetentionId)).resolves.toBe(false);
    await expect(exists(withinRetentionId)).resolves.toBe(true);
    await expect(exists(notExpiredId)).resolves.toBe(true);
  });

  it('오래된 순서로 지운다(ORDER BY expires_at)', async () => {
    // `purgeExpiredRefreshSessions`는 조건에 맞는 행을 빈 배치를 볼 때까지 전부
    // 지우므로, 호출이 끝난 뒤의 DB 상태만으로는 각 배치가 오래된 순서로 골랐는지
    // 확인할 수 없다 — 잠기지 않은 대상 행은 순서와 무관하게 결국 다 지워지기
    // 때문이다(배치가 여러 번 걸릴 뿐, 함수가 반환할 때는 이미 다 사라진 뒤다). 그래서
    // 실제 배치가 도는 문장(`PURGE_BATCH_SQL`)을 `LIMIT 1`로 직접 한 번만 돌려, 더
    // 오래전에 만료된 쪽이 실제로 선택되는지를 그 자리에서 확인한다.
    const userId = await createUser('ordering');
    const now = Date.now();
    const olderId = await createSession(userId, new Date(now - 300_000));
    const newerId = await createSession(userId, new Date(now - 120_000));

    const cutoff = new Date(now - 60_000);
    // TypeORM의 Postgres 드라이버는 DELETE 문에 한해 RETURNING 행 배열이 아니라
    // [행 배열, 영향받은 행 수] 튜플을 돌려준다(`purge-expired-refresh-sessions.ts`의
    // `runBatch` 주석 참고) — 그래서 첫 번째 원소만 꺼내 쓴다.
    const [rows] = await dataSource.query<[{ id: string }[], number]>(PURGE_BATCH_SQL, [cutoff, 1]);

    expect(rows.map((row) => row.id)).toEqual([olderId]);
    await expect(exists(olderId)).resolves.toBe(false);
    await expect(exists(newerId)).resolves.toBe(true);
  });

  it('batchSize:1에 만료 행 3개면 batches가 3이고 deleted가 3이다', async () => {
    // 배치가 실제로 여러 번 도는지의 증거다. 하나씩 지워도 정확히 3번만 도는지 본다 —
    // 3은 batchSize(1)의 배수라서, 다 지웠는지 확인하는 빈 배치를 셈에 넣으면 4가
    // 나온다. `batches`는 그 확인용 빈 배치를 세지 않는다(`purge-expired-refresh
    // -sessions.ts`의 `batches` 계산 주석 참고) — 그래서 3이다.
    const userId = await createUser('batching');
    const now = Date.now();
    const id1 = await createSession(userId, new Date(now - 300_000));
    const id2 = await createSession(userId, new Date(now - 200_000));
    const id3 = await createSession(userId, new Date(now - 100_000));

    const result = await purgeExpiredRefreshSessions(dataSource, {
      retentionSeconds: 0,
      batchSize: 1,
      lockTimeoutMs: 500,
    });

    expect(result).toEqual({ deleted: 3, batches: 3 });
    await expect(exists(id1)).resolves.toBe(false);
    await expect(exists(id2)).resolves.toBe(false);
    await expect(exists(id3)).resolves.toBe(false);
  });

  it('지울 것이 없으면 deleted:0, batches:1이다', async () => {
    // 빈 배치를 보고 멈춘 것 자체가 유일한 시도이므로 1로 보고한다.
    const result = await purgeExpiredRefreshSessions(dataSource, {
      retentionSeconds: 0,
      batchSize: 10,
      lockTimeoutMs: 500,
    });

    expect(result).toEqual({ deleted: 0, batches: 1 });
  });

  it('lockTimeoutMs가 음이 아닌 정수가 아니면 TypeError이고, 배치를 하나도 돌리지 않는다', async () => {
    const userId = await createUser('typeerror');
    // 이 행이 여전히 존재한다는 것이 "루프를 시작하기도 전에 검사에서 던졌다"는 증거다.
    const targetId = await createSession(userId, new Date(Date.now() - 120_000));

    await expect(
      purgeExpiredRefreshSessions(dataSource, {
        retentionSeconds: 0,
        batchSize: 10,
        lockTimeoutMs: 1.5,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      purgeExpiredRefreshSessions(dataSource, {
        retentionSeconds: 0,
        batchSize: 10,
        lockTimeoutMs: -1,
      }),
    ).rejects.toThrow(TypeError);

    await expect(exists(targetId)).resolves.toBe(true);
  });

  it('가리키는 대상 행이 지워지면 replaced_by_id가 null이 되고, 그 행 자체는 남는다', async () => {
    // newSession(B)이 곧 purge 대상(만료)이고, oldSession(A)이 B를 replacedById로
    // 가리킨다(회전으로 폐기된 옛 세션이 새 세션을 가리키는 실제 모양,
    // `refresh-session.ts`의 rotateSession 참고). A 자신은 만료되지 않았으므로 이
    // 배치의 삭제 대상이 아니다 — 오직 cascade로만 바뀌어야 한다.
    const userId = await createUser('cascade');
    const now = Date.now();
    const newSessionId = await createSession(userId, new Date(now - 120_000));
    const oldSessionId = await createSession(userId, new Date(now + 3_600_000), {
      revokedAt: new Date(),
      replacedById: newSessionId,
    });

    await purgeExpiredRefreshSessions(dataSource, {
      retentionSeconds: 0,
      batchSize: 10,
      lockTimeoutMs: 500,
    });

    await expect(exists(newSessionId)).resolves.toBe(false);
    const old = await dataSource.manager.findOneBy(RefreshSession, { id: oldSessionId });
    if (old === null) {
      throw new Error('oldSession이 남아 있어야 하는데 찾을 수 없다');
    }
    expect(old.replacedById).toBeNull();
  });
});
