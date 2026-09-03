import { Inject, Injectable } from '@nestjs/common';
import { JsonWebTokenError, JwtService, TokenExpiredError } from '@nestjs/jwt';
import { JsonApiError } from '../jsonapi/errors.js';
import type { JwtSettings } from '../../config/settings.js';

/**
 * JWT 서명과 검증.
 *
 * `JwtModule`을 쓰지 않고 `JwtService`를 직접 만든다. 실측으로 확인한 바로는
 * `JwtModule.register()`는 옵션 프로바이더 하나를 만들어 주는 설탕일 뿐이고, 모듈을
 * 늘리지 않는 것이 이 템플릿의 방침이다. 덕분에 단위 테스트도 DI 없이
 * `new TokenService(settings)`로 끝난다.
 *
 * `jsonwebtoken`을 직접 import하지 않는다 — 이 프로젝트의 직접 의존성이 아니라
 * `@nestjs/jwt`의 전이 의존성이고, pnpm의 엄격한 `node_modules`에서는 직접 import가
 * 막힌다. 두 오류 클래스는 `@nestjs/jwt`가 그대로 재노출한다.
 */

/** `JwtSettings`를 주입받는 토큰. 문자열 상수인 이유는 인터페이스에 런타임 값이 없어서다. */
export const JWT_SETTINGS_TOKEN = 'auth:jwt-settings';

/** access token이 나르는 것. */
export interface AccessTokenClaims {
  readonly userId: string;
}

/** refresh token이 나르는 것. `sessionId`가 `refresh_sessions` 행을 찾는 열쇠다. */
export interface RefreshTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
}

/**
 * token 종류.
 *
 * 이 클레임이 없으면 refresh token을 `Authorization: Bearer`에 그대로 넣어 쓸 수 있고,
 * 그 순간 access token의 짧은 수명이라는 계약이 사라진다.
 */
const ACCESS = 'access' as const;
const REFRESH = 'refresh' as const;
type TokenKind = typeof ACCESS | typeof REFRESH;

@Injectable()
export class TokenService {
  private readonly jwt: JwtService;

  constructor(@Inject(JWT_SETTINGS_TOKEN) private readonly settings: JwtSettings) {
    this.jwt = new JwtService({ secret: settings.secret });
  }

  signAccessToken(userId: string): string {
    return this.jwt.sign(
      { typ: ACCESS },
      {
        subject: userId,
        issuer: this.settings.issuer,
        audience: this.settings.audience,
        expiresIn: this.settings.accessExpiresSeconds,
      },
    );
  }

  signRefreshToken(userId: string, sessionId: string): string {
    return this.jwt.sign(
      { typ: REFRESH },
      {
        subject: userId,
        jwtid: sessionId,
        issuer: this.settings.issuer,
        audience: this.settings.audience,
        expiresIn: this.settings.refreshExpiresSeconds,
      },
    );
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const payload = this.verify(token, ACCESS);
    return { userId: claimString(payload, 'sub') };
  }

  verifyRefreshToken(token: string): RefreshTokenClaims {
    const payload = this.verify(token, REFRESH);
    return { userId: claimString(payload, 'sub'), sessionId: claimString(payload, 'jti') };
  }

  /**
   * 서명·발급자·대상·만료를 확인하고 종류를 대조한다.
   *
   * `verify<Record<string, unknown>>`로 부르는 이유: 타입 인자를 생략하면 기본값이
   * `any`라 반환값이 그대로 `any`가 되고, `strictTypeChecked` 아래에서 뒤따르는 모든
   * 접근이 오류가 된다.
   */
  private verify(token: string, kind: TokenKind): Record<string, unknown> {
    let payload: Record<string, unknown>;
    try {
      payload = this.jwt.verify<Record<string, unknown>>(token, {
        issuer: this.settings.issuer,
        audience: this.settings.audience,
        clockTolerance: this.settings.leewaySeconds,
      });
    } catch (error: unknown) {
      // `TokenExpiredError`가 `JsonWebTokenError`를 상속한다. 순서를 뒤집으면 만료가
      // INVALID_TOKEN으로 뭉개져, 클라이언트가 "갱신하면 되는 상황"과 "다시 로그인해야
      // 하는 상황"을 구분하지 못한다.
      if (error instanceof TokenExpiredError) {
        throw new JsonApiError('TOKEN_EXPIRED');
      }
      if (error instanceof JsonWebTokenError) {
        throw new JsonApiError('INVALID_TOKEN');
      }
      throw error;
    }

    if (payload.typ !== kind) {
      throw new JsonApiError('INVALID_TOKEN', { detail: `expected a ${kind} token` });
    }
    return payload;
  }
}

/**
 * 문자열 클레임을 꺼낸다.
 *
 * 서명이 맞는 token에 `sub`가 없다는 것은 우리가 서명하지 않은 모양이라는 뜻이므로
 * 사용자 입력 오류로 다룬다 — 프로그래밍 오류가 아니다. 비밀 키를 가진 쪽이 만든
 * 이상한 token일 수 있고, 그것은 401이 맞다.
 */
function claimString(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== 'string') {
    throw new JsonApiError('INVALID_TOKEN', { detail: `token is missing ${name}` });
  }
  return value;
}
