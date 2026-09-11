import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';

const VENDOR = 'application/vnd.api+json';

interface ErrorBody {
  errors: { code: string }[];
}

interface TokensBody {
  data: { attributes: Record<string, unknown> };
}

describe('GET /api/v1/users/me', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  let accessToken: string;

  const api = (): ReturnType<typeof request> => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);

    await api()
      .post('/api/v1/auth/register')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'users',
            attributes: { email: 'me-나@example.com', password: '충분히-긴-비밀번호-1234' },
          },
        }),
      )
      .expect(201);

    const login = await api()
      .post('/api/v1/auth/login')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'authCredentials',
            attributes: { email: 'me-나@example.com', password: '충분히-긴-비밀번호-1234' },
          },
        }),
      )
      .expect(200);
    accessToken = String((login.body as TokensBody).data.attributes.accessToken);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM users WHERE email LIKE 'me-%'`);
    await app.close();
  });

  it('토큰이 있으면 자기 자신을 낸다', async () => {
    const response = await api()
      .get('/api/v1/users/me')
      .set('Accept', VENDOR)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      data: { type: 'users', attributes: { email: 'me-나@example.com' } },
    });
  });

  it('토큰이 없으면 401이다', async () => {
    const response = await api().get('/api/v1/users/me').set('Accept', VENDOR).expect(401);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
