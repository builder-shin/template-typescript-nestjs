import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';

/**
 * 본문 파서를 죽이지 않았는지 확인하는 프로브 라우트.
 *
 * Nest 라우트로는 이것을 물을 수 없다 — 이 저장소의 자원 라우트는 협상 가드가
 * `application/json` 요청을 본문을 보기도 전에 415로 되돌리고, 평문 JSON을 받는
 * 라우트는 아직 없다. 그래서 파서 미들웨어 **뒤**에 있는 Express 인스턴스에 라우트를
 * 직접 하나 얹어 파싱 결과를 되비춘다. 이 앱은 이 스펙 파일 전용이라 다른 라우트
 * 계약에 영향을 주지 않는다.
 */
const PROBE_PATH = '/__body-parser-probe';

/** Express 인스턴스에서 실제로 쓰는 부분만 좁혀 받는다. `getInstance()`는 `any`다. */
interface ProbeExpressApp {
  post(
    path: string,
    handler: (request: { body: unknown }, response: { json(body: unknown): unknown }) => void,
  ): unknown;
  get(setting: string): unknown;
}

describe('HTTP 조립', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    // `init()` 뒤에는 Nest의 catch-all not-found 핸들러가 이미 붙어 있어 나중에 얹은
    // 라우트가 404가 된다. 그래서 조립 훅을 쓴다(`app-factory.ts` 주석 참고).
    app = await createTestApp((application) => {
      const instance = application.getHttpAdapter().getInstance() as ProbeExpressApp;
      instance.post(PROBE_PATH, (probeRequest, probeResponse) => {
        probeResponse.json({ received: probeRequest.body });
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('vendor 미디어 타입 본문을 파싱한다', async () => {
    // 파싱되지 않으면 본문이 `{}`가 되어 "type이 없다"는 400이 나간다.
    // 여기서 400 INVALID_JSONAPI_DOCUMENT가 아니라 TYPE_MISMATCH가 나오는 것이
    // 본문이 실제로 읽혔다는 증거다.
    const response = await request(app.getHttpServer())
      .post('/api/v1/examples')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/vnd.api+json')
      .send(JSON.stringify({ data: { type: 'others', attributes: { title: '제목' } } }));

    const body = response.body as { errors: { code: string }[] };
    expect(body.errors[0]?.code).toBe('TYPE_MISMATCH');
  });

  it('기본 JSON 파서를 죽이지 않는다', async () => {
    // `useBodyParser`는 기본 파서를 교체한다(실측). 두 타입을 함께 넘기지 않으면
    // application/json 본문이 조용히 `{}`가 된다 — 그 사고는 이 저장소가 JSON:API가
    // 아닌 본문을 받는 첫 라우트를 추가하는 날에야 드러난다.
    const response = await request(app.getHttpServer())
      .post(PROBE_PATH)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ 인사: '본문' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: { 인사: '본문' } });
  });

  it('질의 파서를 simple로 고정한다', () => {
    // `src/app/jsonapi/`의 파서들은 `filter[title]` 같은 대괄호 키를 그대로 가진
    // 평평한 객체를 전제로 한다. `extended`로 바뀌면 그 전제가 조용히 무너진다.
    const instance = app.getHttpAdapter().getInstance() as ProbeExpressApp;
    expect(instance.get('query parser')).toBe('simple');
  });
});
