import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Test } from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';
import { JWT_SETTINGS_TOKEN } from '../../src/app/auth/tokens.js';
import type { JwtSettings } from '../../src/config/settings.js';

const VENDOR = 'application/vnd.api+json';
// `auth-`로 시작하면 안 된다 — `auth-api.spec.ts`의 정리 쿼리(`LIKE 'auth-%'`)가 다른
// 워커에서 이 계정을 지운다(실측 2026-09-30: 로그인이 간헐적으로 실패했다).
const EMAIL = 'parity-auth@example.com';
const PASSWORD = 'password-parity-123';
interface Document {
  data: { id: string; attributes: Record<string, unknown>; links?: { self: string } };
  errors?: { code: string; source?: { header?: string } }[];
}
describe('canonical auth security contract', () => {
  let app: INestApplication<Server>;
  let db: DataSource;
  let settings: JwtSettings;
  const post = (action: string, type: string, attributes: Record<string, unknown>): Test =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/${action}`)
      .set('Content-Type', VENDOR)
      .send(JSON.stringify({ data: { type, attributes } }));
  const login = (): Test => post('login', 'authCredentials', { email: EMAIL, password: PASSWORD });
  const refresh = (refreshToken: unknown): Test =>
    post('refresh', 'refreshTokens', { refreshToken });
  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    settings = app.get(JWT_SETTINGS_TOKEN);
  });
  beforeEach(async () => {
    await post('register', 'users', { email: EMAIL, password: PASSWORD }).expect(201);
  });
  afterEach(async () => {
    await db.query('DELETE FROM users WHERE email = $1', [EMAIL]);
  });
  afterAll(async () => {
    await app.close();
  });
  it('commits replay revocation for successor and independent sessions', async () => {
    const first = (await login()).body as Document;
    const independent = (await login()).body as Document;
    const second = (await refresh(first.data.attributes.refreshToken).expect(200)).body as Document;
    await refresh(first.data.attributes.refreshToken).expect(401);
    await refresh(second.data.attributes.refreshToken).expect(401);
    await refresh(independent.data.attributes.refreshToken).expect(401);
  });
  it('commits inactive refresh revocation after reactivation', async () => {
    const first = (await login()).body as Document;
    await db.query('UPDATE users SET is_active = false WHERE email = $1', [EMAIL]);
    await refresh(first.data.attributes.refreshToken).expect(403);
    await db.query('UPDATE users SET is_active = true WHERE email = $1', [EMAIL]);
    await refresh(first.data.attributes.refreshToken).expect(401);
  });
  it('allows inactive users to read their own profile', async () => {
    const first = (await login()).body as Document;
    await db.query('UPDATE users SET is_active = false WHERE email = $1', [EMAIL]);
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${String(first.data.attributes.accessToken)}`)
      .expect(200);
    expect((response.body as Document).data.attributes.isActive).toBe(false);
  });
  it('returns Authorization source for malformed scheme', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Basic abc')
      .expect(401);
    expect((response.body as Document).errors?.[0]).toMatchObject({
      code: 'INVALID_TOKEN',
      source: { header: 'Authorization' },
    });
  });
  it('requires exp and iat on signed access tokens', async () => {
    const first = (await login()).body as Document;
    const jwt = new JwtService({ secret: settings.secret });
    const original = jwt.decode<Record<string, unknown>>(String(first.data.attributes.accessToken));
    for (const missing of ['exp', 'iat']) {
      const claims = { ...original };
      Reflect.deleteProperty(claims, missing);
      const token = jwt.sign(claims, { noTimestamp: missing === 'iat' });
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
  });
  it('validates login limits and does not impose a refresh token maximum', async () => {
    await post('login', 'authCredentials', { email: EMAIL, password: 'x'.repeat(11) }).expect(422);
    await refresh('x'.repeat(4097)).expect(401);
  });
  it('accepts supported UUID subjects and JWT date limits for an existing user', async () => {
    const first = (await login()).body as Document;
    const jwt = new JwtService({ secret: settings.secret });
    const original = jwt.decode<Record<string, unknown>>(String(first.data.attributes.accessToken));
    const subject = String(original.sub);
    for (const sub of [
      subject.replaceAll('-', ''),
      `{${subject}}`,
      `urn:uuid:${subject}`,
      subject.toUpperCase(),
    ]) {
      const token = jwt.sign({
        ...original,
        sub,
        jti: String(original.jti).replaceAll('-', ''),
        exp: 253402300799.5,
      });
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer  ${token}`)
        .expect(200);
    }
    const future = jwt.sign({
      ...original,
      iat: Math.floor(Date.now() / 1000) + 3600,
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${future}`)
      .expect(401);
    expect((response.body as Document).errors?.[0]).toMatchObject({ code: 'INVALID_TOKEN' });
  });
  it('normalizes decomposed local parts and treats IDNA spellings as one identity', async () => {
    const suffix = Date.now().toString();
    const original = `cafe\u0301-${suffix}@xn--bcher-kva.example.com`;
    const canonical = `café-${suffix}@bücher.example.com`;
    try {
      const registered = await post('register', 'users', {
        email: original,
        password: PASSWORD,
      }).expect(201);
      expect((registered.body as Document).data.attributes.email).toBe(canonical);
      await post('login', 'authCredentials', { email: canonical, password: PASSWORD }).expect(200);
      await post('register', 'users', { email: canonical, password: PASSWORD }).expect(409);
    } finally {
      await db.query('DELETE FROM users WHERE email=$1', [canonical]);
    }
  });
  it('returns canonical user links and registration Location', async () => {
    await db.query('DELETE FROM users WHERE email = $1', [EMAIL]);
    const response = await post('register', 'users', { email: EMAIL, password: PASSWORD }).expect(
      201,
    );
    expect(response.headers.location).toBe('/api/v1/users/me');
    expect((response.body as Document).data.links?.self).toBe('/api/v1/users/me');
  });
  it('rechecks activation after waiting for the user lock during login', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [EMAIL]);
    const pending = login().then((response) => response.status);
    try {
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !waiting) {
        const rows = await db.query<{ waiting: boolean }[]>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE '%users%' AND query LIKE '%FOR UPDATE%'
        ) AS waiting`);
        waiting = rows[0]?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await runner.query('UPDATE users SET is_active = false WHERE email = $1', [EMAIL]);
      await runner.commitTransaction();
      expect(await pending).toBe(403);
      const rows = await db.query<{ count: string }[]>(
        'SELECT count(*) FROM refresh_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1',
        [EMAIL],
      );
      expect(rows[0]?.count).toBe('0');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await pending;
    }
  });
  it('binds the exact signed refresh token to the stored digest', async () => {
    const first = (await login()).body as Document;
    const jwt = new JwtService({ secret: settings.secret });
    const claims = jwt.decode<Record<string, unknown>>(String(first.data.attributes.refreshToken));
    const altered = jwt.sign({ ...claims, extra: true });
    await refresh(altered).expect(401);
    await post('logout', 'refreshTokens', { refreshToken: altered }).expect(401);
    await refresh(first.data.attributes.refreshToken).expect(200);
  });
  it('rejects signed logout tokens with no persisted session', async () => {
    const first = (await login()).body as Document;
    await db.query('DELETE FROM refresh_sessions WHERE id = $1', [first.data.id]);
    await post('logout', 'refreshTokens', {
      refreshToken: first.data.attributes.refreshToken,
    }).expect(401);
  });
  it('revokes an expired signed refresh token while committing the error', async () => {
    const first = (await login()).body as Document;
    await db.query(
      "UPDATE refresh_sessions SET expires_at = now() - interval '1 second' WHERE id = $1",
      [first.data.id],
    );
    await refresh(first.data.attributes.refreshToken).expect(401);
    const rows = await db.query<{ revoked_at: Date | null }[]>(
      'SELECT revoked_at FROM refresh_sessions WHERE id = $1',
      [first.data.id],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
  });
  it.each(['refresh', 'logout'])(
    'commits revocation when %s receives an expired JWT',
    async (action) => {
      const first = (await login()).body as Document;
      const jwt = new JwtService({ secret: settings.secret });
      const original = jwt.decode<Record<string, unknown>>(
        String(first.data.attributes.refreshToken),
      );
      const rawToken = jwt.sign({ ...original, exp: Math.floor(Date.now() / 1000) - 120 });
      const digest = createHash('sha256').update(rawToken).digest('hex');
      await db.query('UPDATE refresh_sessions SET token_hash = $1 WHERE id = $2', [
        digest,
        first.data.id,
      ]);
      const response = await post(action, 'refreshTokens', { refreshToken: rawToken }).expect(401);
      expect((response.body as Document).errors?.[0]?.code).toBe('TOKEN_EXPIRED');
      const rows = await db.query<{ revoked_at: Date | null }[]>(
        'SELECT revoked_at FROM refresh_sessions WHERE id = $1',
        [first.data.id],
      );
      expect(rows[0]?.revoked_at).not.toBeNull();
    },
  );
  it('rejects an expired JWT whose required claims are invalid', async () => {
    const first = (await login()).body as Document;
    const jwt = new JwtService({ secret: settings.secret });
    const original = jwt.decode<Record<string, unknown>>(
      String(first.data.attributes.refreshToken),
    );
    const rawToken = jwt.sign({
      ...original,
      type: 'access',
      exp: Math.floor(Date.now() / 1000) - 120,
    });
    const response = await refresh(rawToken).expect(401);
    expect((response.body as Document).errors?.[0]?.code).toBe('INVALID_TOKEN');
  });
  it('preserves PostgreSQL microseconds in the user profile', async () => {
    const first = (await login()).body as Document;
    await db.query(
      "UPDATE users SET created_at = '2026-01-01T00:00:00.123456Z', updated_at = '2026-01-01T00:00:00.654321Z' WHERE email = $1",
      [EMAIL],
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${String(first.data.attributes.accessToken)}`)
      .expect(200);
    expect((response.body as Document).data.attributes).toMatchObject({
      createdAt: '2026-01-01T00:00:00.123456+00:00',
      updatedAt: '2026-01-01T00:00:00.654321+00:00',
    });
  });
});
