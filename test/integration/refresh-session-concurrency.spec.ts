import { IsNull } from 'typeorm';
import type { DataSource } from 'typeorm';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { RefreshSession } from '../../src/app/models/refresh-session.entity.js';
import { User } from '../../src/app/models/user.entity.js';
import { issueSession, rotateSession } from '../../src/app/auth/refresh-session.js';
import { createTestDataSource } from '../db/fixture.js';

const TTL = 3600;

// 이 스위트만 쓰는 이메일. 고정값이다 — `examples-put.spec.ts`의 고정 id와 같은 이유로,
// `afterEach`가 이 값만 지우면 되고 다른 스위트의 행과 섞일 일이 없다.
const EMAIL = 'refresh-concurrency@example.test';

/** 던진 오류의 JSON:API 코드를 꺼낸다. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof JsonApiError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('오류가 나지 않았다');
}

/**
 * `rotateSession`의 `FOR UPDATE` 잠금이 실제 동시 회전을 막는지 검증한다.
 *
 * `refresh-session.spec.ts`의 "이미 회전한 세션을 다시 쓰면 TOKEN_REVOKED다"는
 * `withRollback`의 단일 매니저·단일 트랜잭션 안에서 **순차** 호출한다 — 두 번째 호출이
 * 첫 번째가 같은 트랜잭션 안에서 이미 써 둔 값을 그대로 읽으므로, `FOR UPDATE`를
 * 지워도 통과한다(실측: 아래 "레드 실측"). 진짜 경합은 서로 다른 두 커넥션이 같은
 * 행을 **동시에** 봐야 성립하므로, 이 파일만 행을 실제로 커밋한다.
 *
 * `acquireCommitLock`은 잡지 않는다. 그 잠금은 같은 테이블에 커밋하는 스위트끼리만
 * 필요한데(`fixture.ts`의 문서 주석 참고), `users`/`refresh_sessions`에 실제로
 * 커밋하는 통합 스펙은 이 파일 하나뿐이다(`grep -rl "save(User\|save(RefreshSession"
 * test/`로 확인 — 나머지는 전부 `withRollback`).
 */
describe('refresh session 회전 동시성', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterEach(async () => {
    // `users`만 지우면 된다 — `user_id`가 `ON DELETE CASCADE`라 `refresh_sessions`도
    // 함께 사라진다. 조건 없는 DELETE는 쓰지 않는다: Jest가 스펙 파일을 워커로 병렬
    // 실행하고 DB는 하나를 공유한다.
    await dataSource.query('DELETE FROM users WHERE email = $1', [EMAIL]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('동시에 두 트랜잭션이 같은 세션을 회전하면 하나만 성공하고 나머지는 TOKEN_REVOKED다', async () => {
    // 1. 사용자와 세션 하나를 만들고 커밋한다. `dataSource.manager`는 어떤 QueryRunner의
    //    트랜잭션에도 묶여 있지 않으므로 각 호출이 곧바로 커밋된다.
    const user = await dataSource.manager.save(User, {
      email: EMAIL,
      passwordHash: 'x',
      isActive: true,
    });
    const original = await issueSession(dataSource.manager, user.id, TTL);

    // 2. 트랜잭션 두 개(A, B)를 각각 연다. 둘 다 열린 뒤에 회전을 시작한다.
    const runnerA = dataSource.createQueryRunner();
    await runnerA.connect();
    await runnerA.startTransaction();
    const runnerB = dataSource.createQueryRunner();
    await runnerB.connect();
    await runnerB.startTransaction();

    try {
      // 3. rotateSession(A)와 rotateSession(B)를 동시에 띄운다 — 어느 쪽도 여기서
      //    await하지 않는다. A가 먼저 호출되므로 SELECT ... FOR UPDATE도 먼저 나간다.
      //    잠금이 있으면 A가 행을 잡고, B의 SELECT ... FOR UPDATE는 그 자리에서 막힌다.
      const resultA = rotateSession(runnerA.manager, original.id, TTL);
      const resultB = rotateSession(runnerB.manager, original.id, TTL);

      // 4. A의 회전이 끝나면(아직 커밋 전 — 행 잠금은 유지된다) A를 커밋한다. 그제서야
      //    B의 SELECT ... FOR UPDATE가 풀리고, 커밋된(폐기된) 행을 보고 TOKEN_REVOKED를
      //    던진다.
      //    ※ 순서가 결정적이다 — A를 커밋하기 전에 B를 await하면 영원히 막힌다. B가
      //    기다리는 잠금은 A의 커밋으로만 풀리기 때문이다.
      const rotatedA = await resultA;
      await runnerA.commitTransaction();

      // 5. 단언: A는 성공하고 B는 TOKEN_REVOKED다. 그리고 원래 세션에서 나온 살아
      //    있는 세션이 정확히 하나인지 DB로 확인한다 — 잠금이 없으면 B도 성공해 두
      //    개가 남는다(훔친 token과 원래 token이 나란히 산다. 아래 "레드 실측" 참고).
      expect(rotatedA.userId).toBe(user.id);
      expect(await codeOf(() => resultB)).toBe('TOKEN_REVOKED');

      const aliveCount = await dataSource.manager.count(RefreshSession, {
        where: { userId: user.id, revokedAt: IsNull() },
      });
      expect(aliveCount).toBe(1);
    } finally {
      // 6. 두 트랜잭션 모두 정리한다. A는 이미 커밋됐을 수도(정상 경로) 있고, 위
      //    단언이 실패해 커밋 전에 예외가 났을 수도 있다 — `isTransactionActive`로
      //    실제 상태를 보고 필요할 때만 롤백한다. B는 이 테스트의 모든 경로에서 커밋한
      //    적이 없으므로 무조건 롤백한다. `withRollback`과 같은 이유로 release()는
      //    각자 자신의 try/finally 안에 둔다 — 앞선 정리가 던져도 뒤의 release가
      //    반드시 돌아야 커넥션 풀이 마르지 않는다.
      try {
        try {
          if (runnerA.isTransactionActive) {
            await runnerA.rollbackTransaction();
          }
        } finally {
          await runnerA.release();
        }
      } finally {
        try {
          await runnerB.rollbackTransaction();
        } finally {
          await runnerB.release();
        }
      }
    }
  });
});
