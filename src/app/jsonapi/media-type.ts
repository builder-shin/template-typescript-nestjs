/**
 * JSON:API 1.1 vendor 미디어 타입.
 *
 * 모든 리소스 라우트의 `Accept` 협상과 쓰기 요청의 `Content-Type` 검증이 이 값을 기준으로 한다.
 * `health` 컨트롤러는 협상 대상이 아니므로 이 값을 쓰지 않는다.
 */
export const JSONAPI_MEDIA_TYPE = 'application/vnd.api+json';
