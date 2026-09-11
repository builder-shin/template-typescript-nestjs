import { TokenService } from '../../src/app/auth/tokens.js';
const tokens = new TokenService({
  secret: 'test-only-session-secret-key-32-bytes',
  issuer: 'test',
  audience: 'test',
  accessExpiresSeconds: 900,
  refreshExpiresSeconds: 3600,
  leewaySeconds: 0,
});
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
    const result = await run();
    if (result instanceof JsonApiError) return result.code;
  } catch (error: unknown) {
    if (error instanceof JsonApiError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('오류가 나지 않았다');
}

/** Two real transactions: replay must commit bulk revocation before returning its error. */
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
    const original = await issueSession(dataSource.manager, user.id, TTL, tokens);

    // 2. 트랜잭션 두 개(A, B)를 각각 연다. 둘 다 열린 뒤에 회전을 시작한다.
    const runnerA = dataSource.createQueryRunner();
    await runnerA.connect();
    await runnerA.startTransaction();
    const runnerB = dataSource.createQueryRunner();
    await runnerB.connect();
    await runnerB.startTransaction();

    try {
      // Fix which transaction leads while both remain open.
      await runnerA.manager.findOne(User, {
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      // 3. rotateSession(A)와 rotateSession(B)를 동시에 띄운다 — 어느 쪽도 여기서
      //    await하지 않는다. A가 먼저 호출되므로 SELECT ... FOR UPDATE도 먼저 나간다.
      //    잠금이 있으면 A가 행을 잡고, B의 SELECT ... FOR UPDATE는 그 자리에서 막힌다.
      const resultA = rotateSession(runnerA.manager, original.refreshToken, TTL, tokens);
      const resultB = rotateSession(runnerB.manager, original.refreshToken, TTL, tokens);

      // 4. A의 회전이 끝나면(아직 커밋 전 — 행 잠금은 유지된다) A를 커밋한다. 그제서야
      //    B의 SELECT ... FOR UPDATE가 풀리고, 커밋된(폐기된) 행을 보고 TOKEN_REVOKED를
      //    던진다.
      //    ※ 순서가 결정적이다 — A를 커밋하기 전에 B를 await하면 영원히 막힌다. B가
      //    기다리는 잠금은 A의 커밋으로만 풀리기 때문이다.
      const rotatedA = await resultA;
      if (rotatedA instanceof JsonApiError) throw rotatedA;
      await runnerA.commitTransaction();

      expect(rotatedA.userId).toBe(user.id);
      expect(await codeOf(() => resultB)).toBe('TOKEN_REVOKED');
      await runnerB.commitTransaction();

      const aliveCount = await dataSource.manager.count(RefreshSession, {
        where: { userId: user.id, revokedAt: IsNull() },
      });
      expect(aliveCount).toBe(0);
    } finally {
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
          if (runnerB.isTransactionActive) await runnerB.rollbackTransaction();
        } finally {
          await runnerB.release();
        }
      }
    }
  });
});
