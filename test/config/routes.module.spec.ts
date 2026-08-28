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
    expect(registeredRoutes(app)).toEqual(['GET /health/live', 'GET /health/ready']);
  });
});
