import type { DataSource, EntityManager } from 'typeorm';
import { authenticateRequest } from '../../src/app/auth/current-user.guard.js';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { TokenService } from '../../src/app/auth/tokens.js';
import { User } from '../../src/app/models/user.entity.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';
import type { JwtSettings } from '../../src/config/settings.js';

const SETTINGS: JwtSettings = {
  secret: 'g'.repeat(32),
  issuer: '발급자',
  audience: '대상',
  accessExpiresSeconds: 900,
  refreshExpiresSeconds: 2592000,
  leewaySeconds: 0,
};

const tokens = new TokenService(SETTINGS);

/**
 * 트랜잭션 픽스처가 만든 사용자를 판정이 실제로 볼 수 있도록 같은 `EntityManager`를
 * 그대로 넘긴다. `manager.connection`(= `DataSource`)을 넘기면 판정이 `getRepository`로
 * 자신의 기본 매니저를 쓰게 되는데, 그 매니저는 이 트랜잭션의 `queryRunner`에 묶여 있지
 * 않아 커넥션 풀에서 별도 커넥션을 얻는다 — `withRollback`이 커밋하지 않은 행은 그
 * 별도 커넥션에 보이지 않는다.
 */
function authenticate(manager: EntityManager, authorization?: string): Promise<User> {
  const headers = authorization === undefined ? {} : { authorization };
  return authenticateRequest({ headers }, tokens, manager);
}

async function makeUser(manager: EntityManager, email: string, isActive: boolean): Promise<User> {
  return manager.save(User, { email, passwordHash: 'x', isActive });
}

/** 던진 오류의 JSON:API 코드를 꺼낸다. 401의 원인은 코드까지 봐야 특정된다. */
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

describe('Bearer 인증 판정', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('헤더가 없으면 AUTHENTICATION_REQUIRED다', async () => {
    await withRollback(dataSource, async (manager) => {
      expect(await codeOf(() => authenticate(manager))).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  it('Bearer가 아닌 스킴은 AUTHENTICATION_REQUIRED다', async () => {
    // 무엇을 보냈든 우리가 아는 인증 수단이 아니다 — "토큰이 틀렸다"가 아니라
    // "인증이 없다"에 가깝다.
    await withRollback(dataSource, async (manager) => {
      expect(await codeOf(() => authenticate(manager, 'Basic YWJjOmRlZg=='))).toBe(
        'AUTHENTICATION_REQUIRED',
      );
    });
  });

  it('토큰 자리가 비어 있어도 AUTHENTICATION_REQUIRED다', async () => {
    await withRollback(dataSource, async (manager) => {
      expect(await codeOf(() => authenticate(manager, 'Bearer   '))).toBe(
        'AUTHENTICATION_REQUIRED',
      );
    });
  });

  it('스킴 대소문자를 가리지 않는다', async () => {
    // RFC 9110은 인증 스킴을 대소문자 구분 없이 정한다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅊ@example.test', true);
      const found = await authenticate(manager, `bearer ${tokens.signAccessToken(user.id)}`);
      expect(found.id).toBe(user.id);
    });
  });

  it('활성 사용자를 돌려준다', async () => {
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅋ@example.test', true);
      const found = await authenticate(manager, `Bearer ${tokens.signAccessToken(user.id)}`);
      expect(found.email).toBe('ㅋ@example.test');
    });
  });

  it('비활성 사용자는 USER_INACTIVE다', async () => {
    // 토큰은 멀쩡하다. 다시 로그인해도 풀리지 않는 상황이므로 401의 다른 이름이 필요하다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅌ@example.test', false);
      expect(
        await codeOf(() => authenticate(manager, `Bearer ${tokens.signAccessToken(user.id)}`)),
      ).toBe('USER_INACTIVE');
    });
  });

  it('사라진 사용자를 가리키는 토큰은 INVALID_TOKEN이다', async () => {
    await withRollback(dataSource, async (manager) => {
      const token = tokens.signAccessToken('00000000-0000-4000-8000-000000000000');
      expect(await codeOf(() => authenticate(manager, `Bearer ${token}`))).toBe('INVALID_TOKEN');
    });
  });

  it('uuid 모양이 아닌 사용자 id를 가리키는 토큰은 500이 아니라 INVALID_TOKEN이다', async () => {
    // uuid 컬럼에 uuid가 아닌 문자열로 조회하면 PostgreSQL이 22P02로 죽어 401이어야 할
    // 것이 500이 된다. `userId`는 우리가 서명한 token에서 오지만, 비밀 키를 쥔 쪽은
    // 아무 sub나 실어 보낼 수 있다. refresh-session.ts의 lockSession과 같은 사고다.
    await withRollback(dataSource, async (manager) => {
      const token = tokens.signAccessToken('사용자가-아니다');
      expect(await codeOf(() => authenticate(manager, `Bearer ${token}`))).toBe('INVALID_TOKEN');
    });
  });

  it('refresh 토큰으로는 통과하지 못한다', async () => {
    // Task 4의 `typ` 검사가 이 경로까지 이어지는지 본다.
    await withRollback(dataSource, async (manager) => {
      const user = await makeUser(manager, 'ㅍ@example.test', true);
      const refresh = tokens.signRefreshToken(user.id, '00000000-0000-4000-8000-000000000001');
      expect(await codeOf(() => authenticate(manager, `Bearer ${refresh}`))).toBe('INVALID_TOKEN');
    });
  });
});
