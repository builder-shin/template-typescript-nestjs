import { QueryFailedError } from 'typeorm';
import { RefreshSession } from '../../src/app/models/refresh-session.entity.js';
import { User } from '../../src/app/models/user.entity.js';
import { purgeExpiredRefreshSessions } from '../../src/app/jobs/purge-expired-refresh-sessions.js';
import { acquireCommitLock, createTestDataSource } from '../db/fixture.js';
import type { DataSource } from 'typeorm';
import type { CommitLockHandle } from '../db/fixture.js';

/**
 * `purgeExpiredRefreshSessions`의 경합 계약을 실제 PostgreSQL과 두 커넥션으로 고정한다.
 *
 * **이 스위트는 커밋한다.** 서로 다른 두 커넥션이 같은 행을 봐야 잠금 경합이 성립하고,
 * `withRollback`의 단일 트랜잭션 안에서는 원리상 만들 수 없다 — 다른 커넥션은 그
 * 트랜잭션이 커밋하기 전까지 안의 행을 볼 수 없다. `refresh-session-concurrency
 * .spec.ts`가 정확히 같은 이유로 같은 모양(두 `queryRunner`를 열어 실제로 경합을
 * 일으킨다)을 하고 있으니 그 관용구를 따른다.
 *
 * **`acquireCommitLock`을 잡는다 — 이 판단의 근거.**
 *
 * 지금 `users`/`refresh_sessions`에 실제로 커밋하는 다섯 스위트는
 * `auth-api.spec.ts`(`auth-` 접두사), `users-me.spec.ts`(`me-`),
 * `examples-api.spec.ts`(`examples-api-`), `examples-put.spec.ts`(`examples-put-`),
 * `refresh-session-concurrency.spec.ts`(`refresh-concurrency@example.test` 고정
 * 주소)다. 이 중 넷(`auth-api`/`users-me`/`examples-api`/`examples-put`)은 실제
 * `POST /api/v1/auth/login`을 한 번 이상 거쳐서만 세션을 커밋하고, 그 경로는
 * `auth.controller.ts`의 `issue()` → `issueSession(manager, userId,
 * this.settings.refreshExpiresSeconds)`로 이어진다. `refreshExpiresSeconds`는
 * `loadJwtSettings`(`settings.ts`)가 `JWT_REFRESH_EXPIRES_SECONDS`에서 읽고 기본값은
 * 2,592,000초(30일)다 — 이 저장소의 테스트 환경 어디에서도 이 값을 재정의하지 않는다
 * (`.env.example`은 주석 처리된 예시일 뿐이고, `docker-compose.test.yml`과
 * `scripts/check.sh`에는 `JWT_REFRESH_EXPIRES_SECONDS`/`JWT_`로 시작하는 재정의가
 * 전혀 없다 — 직접 grep으로 확인했다). 나머지 하나(`refresh-session-concurrency
 * .spec.ts`)는 `issueSession`을 직접 부르되 로컬 상수 `TTL = 3600`(1시간)을 쓴다.
 * `issueSession` 자신은 `expiresAt`을 언제나 `new Date(Date.now() + ttlSeconds *
 * 1000)`로만 계산한다(`refresh-session.ts`) — 과거를 넣는 호출 경로가 없다.
 *
 * 즉 이 다섯 스위트가 커밋하는 모든 `refresh_sessions` 행은, 생성되는 바로 그 순간
 * `expires_at`이 최소 1시간(가장 짧은 경우) 뒤, 보통 30일 뒤다. 이 잡의 삭제 조건은
 * `expires_at < now() - retentionSeconds`이고, 우리가 이 저장소 어디서 부르든
 * `retentionSeconds`는 0 이상으로 쓴다(`WorkerSettings.refreshSessionRetentionSeconds`
 * 의 검증 규칙과 같은 전제 — 음수면 "아직 유효한 세션도 지운다"는 뜻이 되어 애초에
 * 잘못된 설정이다). 커트라인이 `now()`를 절대 넘어설 수 없으므로, 최소 1시간 뒤인
 * 행의 `expires_at`이 그 커트라인보다 이전일 수는 산술적으로 없다 — 시간이 거꾸로
 * 흐르지 않는 한 다섯 스위트의 행은 이 잡의 대상 집합에 들어올 수 없다. `expires_at`을
 * 과거로 되돌리는 유일한 코드 경로는 `refresh-session.spec.ts` 96행
 * (`expiresAt: new Date(Date.now() - 1000)`)인데, 그 스위트는 모든 테스트를
 * `withRollback`으로만 감싸고 절대 커밋하지 않는다(`grep -rl "withRollback"
 * test/integration/`로 확인, 그리고 그 파일에 `acquireCommitLock`/커밋 경로가 없다).
 * 그래서 다섯 스위트에 대해서는 이 잠금이 필요 없다 — 이메일 접두사가 겹치지 않기
 * 때문이 아니라(이 잡은애초에 이메일로 스코프되지 않는다), 그 스위트들이 커밋하는
 * 행의 `expires_at`이 시간 산술적으로 이 잡의 대상 범위 안에 들어올 수 없기 때문이다.
 *
 * 그런데 **이 잡은 이메일/사용자로 스코프할 수 없다** — `DELETE FROM refresh_sessions
 * WHERE expires_at < $1`은 테이블 전체를 본다. 그리고 이 태스크가 함께 만드는 또 다른
 * 커밋 스위트 `purge-refresh-sessions.spec.ts`는 정확히 이 잡의 기능 계약을
 * 확인하려고 `expires_at`을 의도적으로 과거로 만들어 커밋한다 — 이 파일도 아래에서
 * 마찬가지다(잠금·SKIP LOCKED 계약을 확인하려면 만료된 행이 실제로 테이블에 있어야
 * 한다). 다섯 기존 스위트와 달리, 이 두 새 스위트는 서로에게 진짜 위험하다: Jest는
 * 스펙 파일을 병렬 워커로 돌리고(`jest.config.js`에 `maxWorkers` 제한이 없다,
 * `pnpm run test`는 `jest --coverage`로 기본값 그대로다), 이 두 파일이 만드는 행은
 * 서로 다른 워커에서 **동시에** 테이블에 존재할 수 있다. 잠금이 없으면:
 *   - 이 파일이 "잠긴 행은 건너뛴다" 테스트를 도는 동안, 다른 파일의 purge 호출이
 *     이 파일의 "잠기지 않은" 나머지 행을 먼저 지워 삭제 개수 단언이 틀어질 수 있다.
 *   - 이 파일이 cascade 잠금 실패를 확인하려고 세션 A를 잠가 두었는데, 다른 파일의
 *     purge 호출이 그사이 A가 가리키는 세션 B를 먼저 지워 버리면(B도 만료돼 있고
 *     이메일로 걸러지지 않으므로 가능하다) 이 파일의 시나리오 자체가 성립하지 않게
 *     된다.
 * 그래서 이 두 스위트는 `acquireCommitLock`을 잡아 서로 배타적으로 돈다.
 * `examples-api.spec.ts`/`examples-put.spec.ts`와도 같은 잠금 키를 공유하므로 그 두
 * 스위트와도 직렬화되지만, 그건 `examples`/`categories`/`tags`와 무관한 부수 효과일
 * 뿐 이 잡의 안전에는 필요 없다 — 잠금 키를 새로 만드는 대신 기존 것을 재사용해
 * 병렬성을 조금 더 내주는 쪽을 택했다(새 키를 만들어도 이 두 스위트끼리는 어차피
 * 직렬화해야 하므로, 잠금 종류를 하나 더 늘리는 이득이 크지 않다).
 */

const EMAIL_PREFIX = 'purge-race-';

/**
 * cascade lock_timeout 테스트에 주는 Jest 타임아웃(ms). 그 테스트 안의 SAFETY_MS
 * (3000ms) + 안전장치가 잠금을 풀어 준 뒤 purge 호출이 스스로 끝나기까지의 여유를
 * 넉넉히 두되, Jest 기본값(5000ms)보다 명시적으로 크게 잡아 이 스펙이 스스로 상한을
 * 갖고 있다는 것을 이 파일만 보고도 알 수 있게 한다 — 그 테스트 자신의 주석 참고.
 */
const TEST_TIMEOUT_MS = 10000;

describe('purgeExpiredRefreshSessions 경합', () => {
  let dataSource: DataSource;
  let commitLock: CommitLockHandle;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    commitLock = await acquireCommitLock(dataSource);
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM users WHERE email LIKE '${EMAIL_PREFIX}%'`);
  });

  afterAll(async () => {
    try {
      await commitLock.release();
    } finally {
      await dataSource.destroy();
    }
  });

  async function createUser(suffix: string): Promise<string> {
    const user = await dataSource.manager.save(User, {
      email: `${EMAIL_PREFIX}${suffix}@example.test`,
      passwordHash: 'x',
      isActive: true,
    });
    return user.id;
  }

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

  /** `error`가 PostgreSQL의 lock_timeout(55P03)로 인한 실패인지 본다. */
  function isLockTimeoutError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError: unknown = error.driverError;
    if (typeof driverError !== 'object' || driverError === null) {
      return false;
    }
    return Reflect.get(driverError, 'code') === '55P03';
  }

  it('다른 트랜잭션이 잡고 있는 만료 행은 건너뛴다(SKIP LOCKED)', async () => {
    const userId = await createUser('skip');
    const now = Date.now();
    const lockedId = await createSession(userId, new Date(now - 300_000));
    const freeId = await createSession(userId, new Date(now - 200_000));

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // lockedId를 잠근 채 커밋하지 않고 둔다. 이 SELECT가 끝난 뒤에야(await로 보장)
      // purge를 부른다 — 순서가 결정적이어야 아래 단언이 흔들리지 않는다.
      const locked = await runner.manager.findOne(RefreshSession, {
        where: { id: lockedId },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked === null) {
        throw new Error('잠글 세션을 찾지 못했다');
      }

      // SKIP LOCKED는 절대 기다리지 않고 잠긴 행을 건너뛰므로, 이 호출은 매달릴 수
      // 없다 — lockedId를 아직 커밋/롤백하지 않았어도 안전하게 await할 수 있다.
      const result = await purgeExpiredRefreshSessions(dataSource, {
        retentionSeconds: 0,
        batchSize: 10,
        lockTimeoutMs: 500,
      });

      expect(result.deleted).toBe(1);
      await expect(exists(freeId)).resolves.toBe(false);
      await expect(exists(lockedId)).resolves.toBe(true);
    } finally {
      // 이 트랜잭션은 이 테스트의 어떤 경로에서도 커밋한 적이 없으므로 무조건
      // 롤백한다 — `refresh-session-concurrency.spec.ts`의 runnerB와 같은 이유다.
      try {
        await runner.rollbackTransaction();
      } finally {
        await runner.release();
      }
    }
  });

  it(
    'replaced_by_id가 가리키는 행을 지우다가 그 행을 참조하는 다른 행이 잠겨 있으면 lock_timeout으로 실패한다(매달리지 않는다)',
    async () => {
      // oldId(A)가 newId(B)를 replacedById로 가리킨다(회전으로 폐기된 옛 세션이 새
      // 세션을 가리키는 실제 모양). B는 만료돼 있어 purge의 삭제 대상이다. B를 지우면
      // ON DELETE SET NULL cascade가 "B를 가리키는" A에도 잠금을 요구한다(SKIP LOCKED는
      // SELECT가 직접 고르는 행의 잠금만 피할 뿐, 이 cascade가 요구하는 잠금은 막아
      // 주지 않는다 — 브리프의 실측 근거). A를 아래에서 미리 잠가 두므로, purge
      // 배치는 그 잠금을 기다리다 lock_timeout으로 실패해야 한다.
      const userId = await createUser('cascade');
      const now = Date.now();
      const newId = await createSession(userId, new Date(now - 300_000));
      const oldId = await createSession(userId, new Date(now + 3_600_000), {
        revokedAt: new Date(),
        replacedById: newId,
      });

      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        // A(oldId)를 잠근 채 커밋도 롤백도 하지 않는다. 이 SELECT가 반드시 아래 purge
        // 호출보다 먼저 끝나 있어야(await로 보장) 경합이 성립한다 — 순서가 결정적이다.
        const locked = await runner.manager.findOne(RefreshSession, {
          where: { id: oldId },
          lock: { mode: 'pessimistic_write' },
        });
        if (locked === null) {
          throw new Error('잠글 세션을 찾지 못했다');
        }

        // 이 테스트의 "매달리지 않는다"는 원래 lockTimeoutMs(300ms)가 실제로 그렇게
        // 만들어 준다는 사실 하나에 기댄다. 그런데 구현이 나중에 회귀해 `SET LOCAL
        // lock_timeout` 문이 빠지면(이 태스크의 레드 실측이 바로 그 경우다),
        // PostgreSQL 기본값은 lock_timeout이 0(무제한)이라 아래 purge 호출이 정말로
        // 매달린다 — 실측으로 확인했다. Jest의 기본 테스트 타임아웃(5000ms)이 이
        // 테스트 "결과"는 실패로 끝내주지만, 매달려 있던 purge 커넥션 자체는 정리되지
        // 않는다(그 커넥션은 여전히 잠금을 기다리며 살아 있다) — Jest 프로세스가 그
        // 열린 핸들 때문에 깨끗이 종료되지 못하면 `./scripts/check.sh`(`--forceExit`
        // 없이 돈다) 전체가 멈출 수 있다. 그래서 Jest 타임아웃 하나만 믿지 않고, 이
        // 스펙 스스로 SAFETY_MS 뒤에 A(oldId)의 잠금을 직접 풀어 버리는 안전장치를
        // 둔다 — 잠금이 풀리면 매달려 있던 purge 호출도 스스로 끝난다. 정상 구현이면
        // lock_timeout이 이 안전장치보다 훨씬 먼저(수백 ms 안에) 실패를 만들어
        // 내므로, 아래 SAFETY_MS 분기는 실제로 도달할 일이 없다 — 도달한다면 그
        // 자체가 "매달리지 않는다" 계약이 깨졌다는 뜻이라 이 테스트를 명확한 사유로
        // 실패시킨다.
        const SAFETY_MS = 3000;
        type Outcome =
          | { readonly kind: 'success' }
          | { readonly kind: 'error'; readonly error: unknown }
          | { readonly kind: 'safety-timeout' };

        const purgeOutcome: Promise<Outcome> = purgeExpiredRefreshSessions(dataSource, {
          retentionSeconds: 0,
          batchSize: 10,
          lockTimeoutMs: 300,
        }).then(
          (): Outcome => ({ kind: 'success' }),
          (error: unknown): Outcome => ({ kind: 'error', error }),
        );
        // 정상 경로(수백 ms 안에 lock_timeout으로 실패)에서는 이 타이머가 절대
        // 발동하지 않는다 — 그런데 켜 둔 채로 두면 Node의 타이머 핸들이 이벤트
        // 루프를 붙잡아 Jest 워커가 깨끗이 종료되지 못한다(실측: `--detectOpenHandles`
        // 없이 그냥 돌리면 "A worker process has failed to exit gracefully" 경고가
        // 뜬다). 그래서 승부가 나는 즉시(둘 중 어느 쪽이 이기든) `clearTimeout`으로
        // 반드시 정리한다.
        let safetyTimer: ReturnType<typeof setTimeout> | undefined;
        const safetyOutcome = new Promise<Outcome>((resolve) => {
          safetyTimer = setTimeout(() => {
            resolve({ kind: 'safety-timeout' });
          }, SAFETY_MS);
        });

        const outcome = await Promise.race([purgeOutcome, safetyOutcome]);
        clearTimeout(safetyTimer);

        if (outcome.kind === 'safety-timeout') {
          // 안전장치가 발동했다 — 직접 잠금을 풀어 매달려 있던 purgeOutcome이
          // 스스로 끝나게 하고, 그 결과를 기다려 커넥션을 온전히 정리한 뒤에 실패로
          // 끝낸다. 여기서 기다리지 않고 그냥 넘어가면 이 테스트는 끝나도 그
          // 커넥션은 뒤에서 계속 무언가를 하고 있을 수 있다.
          await runner.rollbackTransaction();
          await purgeOutcome;
          throw new Error(
            `lock_timeout이 ${String(SAFETY_MS)}ms 안에 작동하지 않았다 — ` +
              `매달림 방지가 깨졌다(안전장치가 대신 잠금을 풀었다)`,
          );
        }

        if (outcome.kind === 'success') {
          throw new Error('lock_timeout으로 실패했어야 하는데 성공했다');
        }
        expect(isLockTimeoutError(outcome.error)).toBe(true);

        // 실패한 배치는 커밋되지 않았다 — B가 그대로 남아 있어야 한다.
        await expect(exists(newId)).resolves.toBe(true);
      } finally {
        // 안전장치 분기를 이미 탔다면 위에서 롤백을 끝냈으므로 여기서는 건너뛴다 —
        // `refresh-session-concurrency.spec.ts`의 runnerA와 같은 이유로
        // `isTransactionActive`로 실제 상태를 보고 판단한다.
        try {
          if (runner.isTransactionActive) {
            await runner.rollbackTransaction();
          }
        } finally {
          await runner.release();
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});
