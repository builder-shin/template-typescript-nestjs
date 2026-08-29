/**
 * JSON:API 1.1 vendor 미디어 타입.
 *
 * Phase 0에는 아직 리소스 라우트도, `Accept`/`Content-Type` 협상 로직도 없다. 지금
 * 이 값의 유일한 소비자는 이 상수 자신의 테스트뿐이다. Phase 1에서 협상 미들웨어와
 * 예외 필터를 추가하면 모든 리소스 라우트의 `Accept` 협상과 쓰기 요청의
 * `Content-Type` 검증이 이 값을 기준으로 하게 된다. `health` 컨트롤러는 그때도
 * 협상 대상이 아니므로 이 값을 쓰지 않는다.
 */
export const JSONAPI_MEDIA_TYPE = 'application/vnd.api+json';
