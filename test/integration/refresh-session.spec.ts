import type { DataSource, EntityManager } from 'typeorm';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { RefreshSession } from '../../src/app/models/refresh-session.entity.js';
import { User } from '../../src/app/models/user.entity.js';
import { issueSession, revokeSession, rotateSession } from '../../src/app/auth/refresh-session.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

const TTL = 3600;

async function makeUser(manager: EntityManager, email: string, isActive = true): Promise<User> {
  return manager.save(User, { email, passwordHash: 'x', isActive });
}

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

describe('refresh session', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('발급하면 만료가 미래이고 폐기되지 않은 행이 생긴다', async () => {
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅁ@example.test');
      const issued = await issueSession(manager, user.id, TTL);

      const row = await manager.findOneByOrFail(RefreshSession, { id: issued.id });
      expect(row.revokedAt).toBeNull();
      expect(row.replacedById).toBeNull();
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('회전하면 옛 세션이 폐기되고 새 세션을 가리킨다', async () => {
    // 스펙 9장의 "refresh token 회전 시 기존 token 즉시 폐기"가 이것이다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅂ@example.test');
      const first = await issueSession(manager, user.id, TTL);

      const second = await rotateSession(manager, first.id, TTL);

      const old = await manager.findOneByOrFail(RefreshSession, { id: first.id });
      expect(old.revokedAt).not.toBeNull();
      expect(old.replacedById).toBe(second.id);
      expect(second.userId).toBe(user.id);
    });
  });

  it('이미 회전한 세션을 다시 쓰면 TOKEN_REVOKED다', async () => {
    // 재사용 탐지의 최소선이다. 훔친 refresh token이 한 번 더 통하면 회전이 사는 값이 없다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅅ@example.test');
      const first = await issueSession(manager, user.id, TTL);
      await rotateSession(manager, first.id, TTL);

      expect(await codeOf(() => rotateSession(manager, first.id, TTL))).toBe('TOKEN_REVOKED');
    });
  });

  it('로그아웃한 세션으로 갱신을 시도하면 TOKEN_REVOKED다', async () => {
    // `revokeSession`과 회전 후 재사용은 같은 `revokedAt !== null` 검사를 공유하지만,
    // 그 사실 자체는 지금까지 테스트로 고정돼 있지 않았다 — 위 테스트는 "회전"이 그
    // 검사를 태우는 것만 보고, "로그아웃"이 태우는지는 보지 않는다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅊ@example.test');
      const issued = await issueSession(manager, user.id, TTL);
      await revokeSession(manager, issued.id);

      expect(await codeOf(() => rotateSession(manager, issued.id, TTL))).toBe('TOKEN_REVOKED');
    });
  });

  it('만료된 세션은 TOKEN_EXPIRED다', async () => {
    // token 서명은 아직 유효한데 행이 만료된 경우다 — 둘의 수명이 갈릴 수 있으므로
    // 행 쪽도 반드시 본다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅇ@example.test');
      const expired = await manager.save(RefreshSession, {
        userId: user.id,
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
        replacedById: null,
      });

      expect(await codeOf(() => rotateSession(manager, expired.id, TTL))).toBe('TOKEN_EXPIRED');
    });
  });

  it('비활성 사용자의 세션을 회전하면 USER_INACTIVE다', async () => {
    // login과 Bearer 가드는 둘 다 isActive를 보는데 회전만 안 보면, 운영자가 계정을
    // 비활성화해도 이미 발급된 refresh token은 계속 회전할 수 있고 issueSession이
    // 회전마다 만료를 새로 미뤄 주므로 그 체인이 무한히 앞으로 미끄러진다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅍ@example.test', false);
      const issued = await issueSession(manager, user.id, TTL);

      expect(await codeOf(() => rotateSession(manager, issued.id, TTL))).toBe('USER_INACTIVE');
    });
  });

  it('없는 세션은 INVALID_TOKEN이다', async () => {
    await withRollback(dataSource, async (manager) => {
      expect(
        await codeOf(() => rotateSession(manager, '00000000-0000-4000-8000-000000000000', TTL)),
      ).toBe('INVALID_TOKEN');
    });
  });

  it('uuid가 아닌 세션 id는 500이 아니라 INVALID_TOKEN이다', async () => {
    // 그대로 질의하면 PostgreSQL이 22P02로 죽어 401이어야 할 것이 500이 된다.
    // Phase 4에서 관계 linkage id로 같은 사고가 났다.
    await withRollback(dataSource, async (manager) => {
      expect(await codeOf(() => rotateSession(manager, '세션이-아니다', TTL))).toBe(
        'INVALID_TOKEN',
      );
    });
  });

  it('폐기는 멱등하다', async () => {
    // 로그아웃 버튼을 두 번 누르는 것은 클라이언트 오류가 아니다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅈ@example.test');
      const issued = await issueSession(manager, user.id, TTL);

      await revokeSession(manager, issued.id);
      const first = await manager.findOneByOrFail(RefreshSession, { id: issued.id });
      await revokeSession(manager, issued.id);
      const second = await manager.findOneByOrFail(RefreshSession, { id: issued.id });

      expect(first.revokedAt).not.toBeNull();
      // 두 번째 폐기가 시각을 덮어쓰지 않는다 — 언제 로그아웃했는지가 흔들리면 안 된다.
      expect(second.revokedAt?.getTime()).toBe(first.revokedAt?.getTime());
    });
  });

  it('없는 세션을 폐기해도 조용하다', async () => {
    // 이미 정리된 세션으로 로그아웃해도 204여야 한다는 계약이 여기서 시작된다.
    await withRollback(dataSource, async (manager) => {
      await expect(
        revokeSession(manager, '00000000-0000-4000-8000-000000000000'),
      ).resolves.toBeUndefined();
    });
  });

  it('uuid가 아닌 id로 폐기해도 조용하다', async () => {
    // 폐기는 "이 세션을 못 쓰게 하라"이고, 가리킬 수조차 없는 id는 이미 그 상태다.
    // 그대로 질의하면 22P02로 죽어 204여야 할 것이 500이 된다.
    await withRollback(dataSource, async (manager) => {
      await expect(revokeSession(manager, '세션이-아니다')).resolves.toBeUndefined();
    });
  });
});
