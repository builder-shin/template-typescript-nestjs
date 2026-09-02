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
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
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

    // OpenAPI는 경로 파라미터를 `:id`가 아니라 `{id}`로 적는다. 같은 라우트 집합을
    // Express 표기로 고정하는 것은 `routes.module.spec.ts`다.
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/v1/examples',
      '/api/v1/examples/{id}',
      '/api/v1/examples/{id}/category',
      '/api/v1/examples/{id}/relationships/category',
      '/api/v1/examples/{id}/relationships/tags',
      '/api/v1/examples/{id}/tags',
      '/health/live',
      '/health/ready',
    ]);
  });
});
