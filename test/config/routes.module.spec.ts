import type { INestApplication } from '@nestjs/common';
import { createTestApp, registeredRoutes } from '../app-factory.js';

describe('명시적 라우트 조립', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('RoutesModule에 등록한 라우트만 노출한다', () => {
    expect(registeredRoutes(app)).toEqual([
      'DELETE /api/v1/examples/:id',
      'DELETE /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples',
      'GET /api/v1/examples/:id',
      'GET /api/v1/examples/:id/category',
      'GET /api/v1/examples/:id/relationships/category',
      'GET /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples/:id/tags',
      'GET /api/v1/users/me',
      'GET /health/live',
      'GET /health/ready',
      'PATCH /api/v1/examples/:id',
      'PATCH /api/v1/examples/:id/relationships/category',
      'PATCH /api/v1/examples/:id/relationships/tags',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/register',
      'POST /api/v1/examples',
      'POST /api/v1/examples/:id/relationships/tags',
      'PUT /api/v1/examples/:id',
    ]);
  });
});
