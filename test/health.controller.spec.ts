import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from './app-factory.js';

// supertest는 `response.body`를 `any`로 노출한다. `strictTypeChecked`의
// `no-unsafe-argument`에 걸리므로 단언 전에 명시적으로 좁힌다.
interface HealthBody {
  readonly status: string;
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
});
