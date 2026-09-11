import { getExactEntities } from '../jsonapi/exact-timestamps.js';
import { Inject, Injectable, createParamDecorator } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { canIdentify } from '../controllers/concerns/relationship-resolver.js';
import { JsonApiError } from '../jsonapi/errors.js';
import { User } from '../models/user.entity.js';
import { TokenService } from './tokens.js';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

/**
 * Bearer access token으로 활성 사용자를 확인한다.
 *
 * 오류를 넷으로 가른다 — 클라이언트가 해야 할 일이 각각 다르기 때문이다.
 * 헤더 없음은 "로그인하라", 이상한 token은 "다시 로그인하라", 만료는 "갱신하라",
 * 비활성은 "관리자에게 문의하라"다. 하나로 뭉개면 클라이언트가 갱신 루프를 돈다.
 *
 * 협상 가드보다 **뒤에** 돈다. `JsonApiNegotiationGuard`는 컨트롤러 단위이고 이 가드는
 * `writeGuards`를 통해 라우트 단위로 붙는데, Nest는 컨트롤러 가드를 먼저 돌린다.
 * 그래서 `Content-Type`이 틀린 인증 없는 쓰기 요청은 415를 받지 401을 받지 않는다.
 */

/** 판정이 읽고 가드가 쓰는 요청의 최소 모양. */
export interface AuthenticatedRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  currentUser?: User;
}

/** `Authorization` 헤더에서 Bearer token을 꺼낸다. 스킴은 대소문자를 가리지 않는다. */
function bearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  const separator = header.indexOf(' ');
  if (separator === -1) {
    return undefined;
  }
  if (header.slice(0, separator).toLowerCase() !== 'bearer') {
    return undefined;
  }
  const token = header.slice(separator + 1).trim();
  return token === '' ? undefined : token;
}

/**
 * 요청 하나를 판정해 활성 사용자를 돌려준다.
 *
 * 가드에서 떼어 낸 이유: `canActivate`를 직접 테스트하려면 `ExecutionContext`를 흉내
 * 내야 하는데, 이 가드가 쓰지 않는 멤버가 대부분이라 캐스트 없이는 만들 수 없다.
 * 캐스트로 때우면 테스트가 판정이 아니라 흉내를 검증하게 된다. 여기에 판정을 두면
 * 요청 객체 하나로 전부 확인된다.
 *
 * 세 번째 인자가 `DataSource`가 아니라 `EntityManager`인 이유: `DataSource.getRepository`는
 * `queryRunner`가 바인딩되지 않은 자신의 기본 매니저를 쓰므로, 커넥션 풀에서 매번 새
 * 커넥션을 얻는다. 테스트가 `withRollback`으로 연 트랜잭션 안에서 만든 사용자는 커밋
 * 전이라 그 별도 커넥션에는 보이지 않는다. 같은 트랜잭션에 바인딩된 `EntityManager`를
 * 그대로 받아야 트랜잭션 픽스처가 만든 행을 판정이 볼 수 있다 — `refresh-session.ts`의
 * 모든 함수가 `DataSource` 대신 `EntityManager`를 받는 것과 같은 이유다. 운영에서는
 * 가드가 요청마다 트랜잭션을 열지 않으므로 `dataSource.manager`(바인딩된 queryRunner
 * 없음)를 넘겨도 동작은 그대로다.
 */
export async function authenticateRequest(
  request: AuthenticatedRequest,
  tokens: TokenService,
  manager: EntityManager,
  requireActive = true,
): Promise<User> {
  const token = bearerToken(request.headers.authorization);
  if (token === undefined) {
    throw new JsonApiError(
      request.headers.authorization === undefined ? 'AUTHENTICATION_REQUIRED' : 'INVALID_TOKEN',
      { source: { header: 'Authorization' } },
    );
  }

  let claims;
  try {
    claims = tokens.verifyAccessToken(token);
  } catch (error: unknown) {
    if (error instanceof JsonApiError)
      throw new JsonApiError(error.code, { source: { header: 'Authorization' } });
    throw error;
  }

  // uuid 모양을 먼저 거른다. uuid 컬럼에 uuid가 아닌 문자열로 조회하면 PostgreSQL이
  // 22P02로 죽어 401이어야 할 것이 500이 된다. `userId`는 우리가 서명한 token에서
  // 오지만, 비밀 키를 쥔 쪽은 아무 `sub`나 실어 보낼 수 있다. `refresh-session.ts`의
  // `lockSession`이 세션 id에 쓰는 것과 같은 방어이고, 같은 `canIdentify`를 그대로
  // 쓴다 — 두 곳이 각자 판정하면 한쪽만 고쳐지는 날이 온다.
  if (!canIdentify(manager, User, claims.userId)) {
    throw new JsonApiError('INVALID_TOKEN', { source: { header: 'Authorization' } });
  }

  const [user] = await getExactEntities(
    manager
      .getRepository(User)
      .createQueryBuilder('auth_user')
      .where('auth_user.id = :id', { id: claims.userId }),
  );
  if (user === undefined) {
    // 서명은 맞는데 가리키는 사용자가 없다. 계정이 지워진 뒤에도 살아 있는 token이다.
    throw new JsonApiError('INVALID_TOKEN', { source: { header: 'Authorization' } });
  }
  if (requireActive && !user.isActive) {
    throw new JsonApiError('USER_INACTIVE');
  }
  return user;
}

@Injectable()
export class JwtActiveUserGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(getDataSourceToken()) private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.currentUser = await authenticateRequest(request, this.tokens, this.dataSource.manager);
    return true;
  }
}

@Injectable()
export class JwtUserGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(getDataSourceToken()) private readonly dataSource: DataSource,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.currentUser = await authenticateRequest(
      request,
      this.tokens,
      this.dataSource.manager,
      false,
    );
    return true;
  }
}

/**
 * 가드가 붙여 둔 사용자를 핸들러 인자로 꺼낸다.
 *
 * 없으면 `TypeError`다 — 가드를 붙이지 않고 이 데코레이터만 쓴 것은 선언 실수이지
 * 사용자 입력 오류가 아니다. 조용히 `undefined`를 넘기면 인증 없이 도는 핸들러가 생긴다.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.currentUser;
    if (user === undefined) {
      throw new TypeError('JwtActiveUserGuard 없이 CurrentUser를 쓸 수 없다');
    }
    return user;
  },
);
