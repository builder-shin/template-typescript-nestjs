import type { NestExpressApplication } from '@nestjs/platform-express';
import { JSONAPI_MEDIA_TYPE } from '../app/jsonapi/media-type.js';

/**
 * 프로덕션과 테스트가 함께 쓰는 HTTP 계층 설정.
 *
 * 두 진입점(`main.ts`, `test/app-factory.ts`)이 각자 설정하면 갈라진다 — 그러면
 * 테스트가 통과하는 앱과 배포되는 앱이 달라진다.
 *
 * `app.init()` 전에 불러야 한다. `useBodyParser`는 파서 미들웨어를 등록하는 것이라
 * 라우트가 붙은 뒤에 부르면 이미 지나간 요청 경로에 끼어들 자리가 없다.
 */
export function configureHttp(app: NestExpressApplication): void {
  // `useBodyParser`는 기본 JSON 파서를 **교체한다**(실측). 벤더 타입만 넘기면
  // `application/json` 본문이 통째로 `{}`가 된다. 지금은 JSON:API 아닌 본문을 받는
  // 라우트가 없지만, 기본 파서를 조용히 죽여 두면 그런 라우트를 처음 추가하는 사람이
  // 원인을 찾는 데 오래 걸린다.
  app.useBodyParser('json', { type: ['application/json', JSONAPI_MEDIA_TYPE] });

  // Express 5의 기본값과 같지만 명시한다. `src/app/jsonapi/`의 파서들이 대괄호를
  // 그대로 가진 평평한 질의 객체를 전제로 쓰여 있고, 이 값이 `extended`로 바뀌면
  // 그 전제가 조용히 무너진다.
  //
  // `app.getHttpAdapter().getInstance().set(...)`으로 쓰지 않는다. 그 반환 타입은
  // `express`의 `Express`인데 이 저장소는 `@types/express`를 설치하지 않으므로
  // 타입이 해석되지 않고, `strictTypeChecked`의 `no-unsafe-call`이 막는다. `app.set`은
  // Nest가 제공하는 `express.set()` 래퍼이고 같은 인스턴스에 같은 값을 쓴다 —
  // 실제로 Express 인스턴스에 기록되는지는 `test/config/http.spec.ts`가 확인한다.
  app.set('query parser', 'simple');
}
