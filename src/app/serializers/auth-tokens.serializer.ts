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
  readonly refreshTokenExpiresIn: number;
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
    // refresh token 의 **남은 수명(초)**이다. 만료 시각(ISO)이 아니다.
    //
    // 프론트엔드는 이 값으로 세션 쿠키 둘의 만료를 정한다. 값이 없으면 수명을
    // 정할 근거가 없어 만료 없는 브라우저 세션 쿠키가 되고, 그러면 **브라우저를
    // 닫는 순간 로그인이 풀린다.** 정본(FastAPI)·Rails 가 내는 이름과 단위가
    // 이것이다(실측: refreshExpiresIn = 2592000).
    refreshExpiresIn: (tokens) => tokens.refreshTokenExpiresIn,
  },
  relationships: {},
};
