import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';

interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, unknown>;
}

describe('OpenAPI 문서', () => {
  // `INestApplication`은 `TServer = any`가 기본값이라 `getHttpServer()`가 `any`를
  // 반환한다. `no-unsafe-argument`에 걸리므로 실제 반환 타입인 `Server`로 좁혀 선언한다.
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<Server>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/schema 가 OpenAPI 문서를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/api/schema');

    expect(response.status).toBe(200);

    const document = response.body as OpenApiDocument;
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.version).toBe('0.1.0');
  });

  it('명시적으로 조립한 라우트만 문서에 나온다', async () => {
    const response = await request(app.getHttpServer()).get('/api/schema');
    const document = response.body as OpenApiDocument;

    expect(Object.keys(document.paths).sort()).toEqual(['/health/live', '/health/ready']);
  });
});
