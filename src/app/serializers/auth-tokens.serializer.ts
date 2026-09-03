import type { ResourceSerializer } from './serializer.js';

/**
 * 발급한 token 한 묶음.
 *
 * 테이블이 없는 자원이다. `serializeResource`는 `entity.id`만 읽고 DB를 보지 않으므로
 * 인메모리 객체를 그대로 넘길 수 있다. `id`는 이 발급에 대응하는 refresh session의
 * id다 — 발급 한 번에 하나씩 대응하는 안정된 값이라 새로 지어낼 필요가 없다.
 *
 * `resourcePath`가 없다. 이 자원을 다시 가리킬 라우트가 없기 때문이다.
 */
export interface AuthTokens {
  readonly id: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresIn: number;
  readonly refreshTokenExpiresAt: Date;
}

export const AUTH_TOKENS_SERIALIZER: ResourceSerializer<AuthTokens> = {
  type: 'authTokens',
  attributes: {
    accessToken: (tokens) => tokens.accessToken,
    refreshToken: (tokens) => tokens.refreshToken,
    // 클라이언트가 `Authorization` 헤더를 조립할 때 쓰는 스킴이다. 고정값이지만
    // 내보내는 편이 낫다 — 받는 쪽이 문자열을 하드코딩하지 않아도 된다.
    tokenType: () => 'Bearer',
    expiresIn: (tokens) => tokens.accessTokenExpiresIn,
    refreshTokenExpiresAt: (tokens) => tokens.refreshTokenExpiresAt.toISOString(),
  },
  relationships: {},
};
