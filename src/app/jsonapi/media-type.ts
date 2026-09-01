/**
 * JSON:API 1.1 vendor 미디어 타입과 그 표기 규칙.
 *
 * 협상 가드(`negotiation.ts`)의 `Accept`/`Content-Type` 판정, 응답 인터셉터
 * (`response.ts`), 예외 필터(`exception-filter.ts`)가 모두 이 값을 기준으로 한다.
 * `health` 컨트롤러는 협상 대상이 아니므로 이 값을 쓰지 않는다.
 */
export const JSONAPI_MEDIA_TYPE = 'application/vnd.api+json';

const CONTENT_TYPE_HEADER = 'content-type';

/** 헤더를 쓸 수 있는 응답. Express 응답과 Node `ServerResponse`가 모두 만족한다. */
export interface HeaderWritableResponse {
  setHeader(name: string, value: string | number | readonly string[]): unknown;
}

/**
 * vendor 타입에 붙은 미디어 타입 파라미터를 떼어낸다.
 *
 * JSON:API 1.1은 vendor 타입에 파라미터를 금지한다. 규격이 예외로 두는 것은 `ext`와
 * `profile` 둘뿐인데, 이 템플릿은 확장도 프로파일도 구현하지 않는다 — 협상 가드도 요청의
 * vendor 타입에서 `q` 외의 파라미터를 전부 거부한다. 그래서 여기서는 파라미터를 가리지
 * 않고 떼어낸다. 나중에 확장을 지원하게 되면 이 함수와 협상 가드를 **같이** 고쳐야 한다.
 *
 * 다른 미디어 타입은 파라미터가 정상이므로 손대지 않는다 — `application/json; charset=utf-8`은
 * 그대로 둔다.
 */
export function stripVendorMediaTypeParameters(value: string): string {
  const separator = value.indexOf(';');
  if (separator === -1) {
    return value;
  }
  const mediaType = value.slice(0, separator).trim().toLowerCase();
  return mediaType === JSONAPI_MEDIA_TYPE ? JSONAPI_MEDIA_TYPE : value;
}

/**
 * 이 응답의 vendor `Content-Type`에 미디어 타입 파라미터가 붙지 못하게 고정한다.
 *
 * **왜 필요한가**: Express의 `res.send()`는 본문이 문자열이면 `Content-Type`에
 * `charset=utf-8`을 무조건 덧붙인다(`express/lib/response.js`의 `setCharset` 호출).
 * Nest의 Express 어댑터는 성공 응답을 `res.json()`으로 내보내고 그것이 다시
 * `res.send()`를 부르므로, 우리가 헤더를 먼저 `application/vnd.api+json`으로 세팅해도
 * 전선에 나가는 값은 `application/vnd.api+json; charset=utf-8`이 된다.
 *
 * 그 값은 JSON:API 1.1이 서버에 금지한 형식이고, 무엇보다 이 템플릿 자신의 협상 가드가
 * 요청에서 415/406으로 거부하는 바로 그 문자열이다 — 서버가 자기 응답의 `Content-Type`을
 * 그대로 되돌려 보내는 클라이언트를 거절하게 된다.
 *
 * 헤더 값이 실제로 기록되는 유일한 통로(`setHeader`)를 감싸서, Express가 나중에 무엇을
 * 덧붙이든 vendor 타입은 맨몸으로 남게 한다. 응답 하나에 두 번 불러도 안전하다 —
 * 파라미터 제거는 멱등이고, 감싼 함수가 다시 감싸질 뿐 재귀하지 않는다.
 */
export function pinJsonApiContentType(response: HeaderWritableResponse): void {
  const write = response.setHeader.bind(response);
  response.setHeader = (name, value) =>
    name.toLowerCase() === CONTENT_TYPE_HEADER && typeof value === 'string'
      ? write(name, stripVendorMediaTypeParameters(value))
      : write(name, value);
}
