import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../../../auth/password.js';
import { issueSession, revokeSession, rotateSession } from '../../../auth/refresh-session.js';
import { JWT_SETTINGS_TOKEN, TokenService } from '../../../auth/tokens.js';
import { JsonApiError } from '../../../jsonapi/errors.js';
import { JsonApiNegotiationGuard } from '../../../jsonapi/negotiation.js';
import { User } from '../../../models/user.entity.js';
import { AUTH_TOKENS_SERIALIZER, USER_SERIALIZER } from '../../../serializers/index.js';
import { AuthCredentials, RefreshTokenInput, UserRegister } from '../../../schemas/index.js';
import { parseWriteDocument } from '../../concerns/document-parsing.js';
import { unwritableRelationshipError } from '../../concerns/relationship-resolver.js';
import { serializeResource } from '../../../serializers/serializer.js';
import { singleDocument } from '../../concerns/documents.js';
import type { AuthTokens } from '../../../serializers/index.js';
import type { EntityManager } from 'typeorm';
import type { JwtSettings } from '../../../../config/settings.js';
import type { RelationshipInput } from '../../../jsonapi/document.js';
import type { ResourceObject } from '../../../serializers/serializer.js';
import type { SingleDocument } from '../../concerns/documents.js';

/**
 * 인증 라우트.
 *
 * `CrudActions`를 쓰지 않는다 — 이 라우트들은 자원 하나의 CRUD가 아니라 서로 다른 네
 * 가지 동작이고, 요청과 응답의 자원 타입도 다르다(`users` → `users`,
 * `authCredentials` → `authTokens`). 문서 파싱과 응답 조립은 같은 헬퍼를 쓰므로
 * 오류 모양은 CRUD 라우트와 어긋나지 않는다.
 */
@Controller('api/v1/auth')
@UseGuards(JsonApiNegotiationGuard)
export class AuthController {
  constructor(
    @Inject(getDataSourceToken()) private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
    @Inject(JWT_SETTINGS_TOKEN) private readonly settings: JwtSettings,
  ) {}

  /**
   * 가입.
   *
   * 중복을 사전 조회로 막지 않는다 — 조회와 삽입 사이에 다른 요청이 들어오면 둘 다
   * 통과한다. 유니크 제약이 실제로 막게 두고 그 오류만 409로 옮긴다.
   */
  @Post('register')
  async register(@Body() body: unknown): Promise<SingleDocument> {
    const parsed = await parseWriteDocument(body, UserRegister, { expectedType: 'users' });
    rejectRelationships(parsed.relationships);
    const passwordHash = await hashPassword(parsed.attributes.password);

    try {
      const user = await this.dataSource
        .getRepository(User)
        .save({ email: parsed.attributes.email, passwordHash, isActive: true });
      return singleDocument(serializeResource(USER_SERIALIZER, user), []);
    } catch (error: unknown) {
      if (isEmailConflict(error)) {
        // 카탈로그(`errors.ts`)의 `EMAIL_ALREADY_REGISTERED` 메시지가 이미 이 상황을
        // 정확히 말하므로 `detail`을 따로 반복하지 않는다 — 이 파일의 다른 오류들
        // (`INVALID_CREDENTIALS`·`USER_INACTIVE`)도 같은 이유로 detail이 없다.
        throw new JsonApiError('EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }
  }

  /**
   * 로그인.
   *
   * 이메일이 없어도 argon2 검증을 한 번 돌린다. 곧바로 돌아오면 응답 시간이 "그 계정은
   * 없다"를 알려 준다.
   *
   * 비밀번호를 먼저 보고 활성 여부를 나중에 본다. 순서를 뒤집으면 비밀번호를 모르는
   * 사람이 `USER_INACTIVE`와 `INVALID_CREDENTIALS`의 차이로 계정 존재를 알아낸다.
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown): Promise<SingleDocument> {
    const parsed = await parseWriteDocument(body, AuthCredentials, {
      expectedType: 'authCredentials',
    });
    rejectRelationships(parsed.relationships);
    const { email, password } = parsed.attributes;

    const user = await this.dataSource.getRepository(User).findOneBy({ email });
    if (user === null) {
      await verifyDummyPassword(password);
      throw new JsonApiError('INVALID_CREDENTIALS');
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new JsonApiError('INVALID_CREDENTIALS');
    }
    if (!user.isActive) {
      throw new JsonApiError('USER_INACTIVE');
    }

    return this.dataSource.transaction(async (manager) =>
      singleDocument(await this.issue(manager, user.id), []),
    );
  }

  /**
   * 갱신.
   *
   * 회전 전체가 한 트랜잭션 안에서 일어난다. 옛 세션을 폐기하고 새 세션을 만드는 두
   * 쓰기가 갈라지면 로그인은 살아 있는데 갱신은 못 하는 상태가 남는다.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown): Promise<SingleDocument> {
    const claims = this.tokens.verifyRefreshToken(await this.readRefreshToken(body));

    return this.dataSource.transaction(async (manager) => {
      const rotated = await rotateSession(
        manager,
        claims.sessionId,
        this.settings.refreshExpiresSeconds,
      );
      return singleDocument(this.serializeTokens(rotated.userId, rotated.id), []);
    });
  }

  /**
   * 로그아웃.
   *
   * 제시한 세션 하나만 폐기하고 `204`를 낸다. 이미 발급된 access token은 만료까지
   * 유효하다(스펙 9장) — 그것을 즉시 막으려면 요청마다 폐기 목록을 보게 되고,
   * 그러면 access token이 짧게 사는 이유가 없어진다.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown): Promise<void> {
    const claims = this.tokens.verifyRefreshToken(await this.readRefreshToken(body));
    await this.dataSource.transaction((manager) => revokeSession(manager, claims.sessionId));
  }

  private async readRefreshToken(body: unknown): Promise<string> {
    const parsed = await parseWriteDocument(body, RefreshTokenInput, {
      expectedType: 'refreshTokens',
    });
    rejectRelationships(parsed.relationships);
    return parsed.attributes.refreshToken;
  }

  private async issue(manager: EntityManager, userId: string): Promise<ResourceObject> {
    const session = await issueSession(manager, userId, this.settings.refreshExpiresSeconds);
    return this.serializeTokens(userId, session.id);
  }

  /**
   * 두 수명 모두 **설정값 그대로** 내보낸다.
   *
   * 세션 행의 `expiresAt`에서 남은 초를 다시 계산하지 않는다 - 발급·회전 직후라
   * 값은 같은데 `Date.now()`가 한 번 더 흐르는 만큼 2591999 같은 값이 나와,
   * 같은 요청이 같은 답을 내지 못하게 된다. `issueSession`·`rotateSession`이
   * 만료 시각을 바로 이 설정값으로 계산하므로 둘은 같은 수를 가리킨다 -
   * 그 둘이 어긋나지 않는지는 통합 테스트가 DB의 `expires_at`과 대조해 지킨다.
   */
  private serializeTokens(userId: string, sessionId: string): ResourceObject {
    const tokens: AuthTokens = {
      id: sessionId,
      accessToken: this.tokens.signAccessToken(userId),
      refreshToken: this.tokens.signRefreshToken(userId, sessionId),
      accessTokenExpiresIn: this.settings.accessExpiresSeconds,
      refreshTokenExpiresIn: this.settings.refreshExpiresSeconds,
    };
    return serializeResource(AUTH_TOKENS_SERIALIZER, tokens);
  }
}

/**
 * 이 네 라우트는 관계를 하나도 갖지 않는다는 것을 강제한다.
 *
 * `users`·`authCredentials`·`refreshTokens`는 관계 스키마 자체가 없다. `CrudActions`가
 * 만드는 라우트(예: `POST /api/v1/examples`)는 스키마에 없는 관계 이름을 보내면
 * `relationship-resolver.ts`의 `resolveRelationships`가 400으로 거절하는데, 이 라우트들이
 * `parsed.relationships`를 그냥 읽지 않고 넘어가면 같은 실수가 여기서는 조용히
 * 무시된다 — 같은 API 안에서 같은 실수가 자원마다 다르게 취급되면 이 템플릿을 베껴
 * 쓰는 사람이 어느 쪽이 규칙인지 알 수 없다. `unwritableRelationshipError`를 그대로
 * 써서 오류 코드·pointer·detail까지 그 경로와 완전히 같게 맞춘다.
 */
function rejectRelationships(relationships: Readonly<Record<string, RelationshipInput>>): void {
  const [name] = Object.keys(relationships);
  if (name !== undefined) {
    throw unwritableRelationshipError(name);
  }
}

/**
 * 이메일 유니크 제약 위반인지 본다.
 *
 * 제약 이름까지 대조하는 이유: `23505`만 보면 앞으로 생길 다른 유니크 제약의 위반도
 * "이미 가입된 이메일"이라고 답하게 된다.
 *
 * `driverError`가 `any`로 선언돼 있어 `Reflect.get`으로 좁혀 읽는다.
 */
function isEmailConflict(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError: unknown = error.driverError;
  if (typeof driverError !== 'object' || driverError === null) {
    return false;
  }
  return (
    Reflect.get(driverError, 'code') === '23505' &&
    Reflect.get(driverError, 'constraint') === 'UQ_users_email'
  );
}
