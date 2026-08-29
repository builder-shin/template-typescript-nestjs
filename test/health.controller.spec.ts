import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from './app-factory.js';
import { ERROR_CATALOG } from '../src/app/jsonapi/errors.js';

// supertest는 `response.body`를 `any`로 노출한다. `strictTypeChecked`의
// `no-unsafe-argument`에 걸리므로 단언 전에 명시적으로 좁힌다.
interface HealthBody {
  readonly status: string;
}

/**
 * `noUncheckedIndexedAccess` 아래에서 `arr[0]`은 `T | undefined`다. 캐스트로 지우는 대신
 * 실제 분기로 좁힌다 — 이 헬퍼가 던지는 경우는 오류 문서가 비어 있다는 뜻이므로
 * 그 자체로 테스트 실패 사유다.
 */
function firstOf<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

describe('HealthController', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live 는 200과 ok 를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body as HealthBody).toEqual({ status: 'ok' });
  });

  it('GET /health/ready 는 200과 ok 를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body as HealthBody).toEqual({ status: 'ok' });
  });

  it('JSON:API vendor 타입이 아니라 평문 JSON으로 응답한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.headers['content-type']).toMatch(/^application\/json/);
  });

  it('없는 health 경로는 404다', async () => {
    const response = await request(app.getHttpServer()).get('/health/unknown');

    expect(response.status).toBe(404);
  });

  it('health 응답에는 vendor Content-Type을 붙이지 않는다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['content-type']).not.toContain('vnd.api+json');
  });

  it('없는 경로는 JSON:API 오류 문서로 응답한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/nope').expect(404);
    expect(response.headers['content-type']).toContain('application/vnd.api+json');
    const body = response.body as { errors: { code: string; status: string }[] };
    const error = firstOf(body.errors);
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.status).toBe('404');
  });

  it('Accept-Language: en 이면 오류 title이 영어다', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/nope')
      .set('Accept-Language', 'en')
      .expect(404);
    const body = response.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.HTTP_ERROR.en);
  });

  it('Accept-Language가 없으면 오류 title이 한국어다', async () => {
    const response = await request(app.getHttpServer()).get('/health/nope').expect(404);
    const body = response.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.HTTP_ERROR.ko);
  });
});
