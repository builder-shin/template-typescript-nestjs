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
      'GET /api/v1/categories',
      'GET /api/v1/categories/:id',
      'GET /api/v1/examples',
      'GET /api/v1/examples/:id',
      'GET /api/v1/examples/:id/category',
      'GET /api/v1/examples/:id/relationships/category',
      'GET /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples/:id/tags',
      'GET /api/v1/tags',
      'GET /api/v1/tags/:id',
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

  it('참조 자원에 쓰기 라우트가 하나도 없다', () => {
    // 등가 비교가 아니라 접두사 검사인 이유: 위 테스트가 이미 전체 집합을 등가로
    // 고정한다. 여기서 보는 것은 "이 두 경로에 GET 아닌 것이 섞이지 않았는가"다.
    const referenceRoutes = registeredRoutes(app).filter(
      (route) => route.includes('/api/v1/categories') || route.includes('/api/v1/tags'),
    );

    expect(referenceRoutes.length).toBeGreaterThan(0);
    for (const route of referenceRoutes) {
      expect(route.startsWith('GET ')).toBe(true);
    }
  });
});
