import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';

describe('HTTP method contract', () => {
  let app: INestApplication<Server>;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    '/api/v1/categories',
    '/api/v1/tags/00000000-0000-4000-8000-000000000000',
    '/health/live',
    '/api/v1/users/me',
  ])('returns 405 for POST %s', async (path) => {
    const response = await request(app.getHttpServer()).post(path);
    expect(response.status).toBe(405);
    expect(response.body as unknown).toMatchObject({
      errors: [{ code: 'HTTP_ERROR', status: '405' }],
    });
    expect(response.headers.allow).toContain('GET');
  });

  it('keeps unknown paths and missing resources at 404', async () => {
    await request(app.getHttpServer()).post('/api/v1/unknown').expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/categories/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });
});
