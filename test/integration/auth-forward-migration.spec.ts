import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { AuthController } from '../../src/app/controllers/api/v1/auth.controller.js';
import { TokenService } from '../../src/app/auth/tokens.js';
import { hashPassword } from '../../src/app/auth/password.js';
import { MIGRATIONS } from '../../src/db/migrations/index.js';
import { AlignAuthContract1789084800000 } from '../../src/db/migrations/20260911000000-align-auth-contract.js';
import { createTestDataSource } from '../db/fixture.js';

const SCHEMA = 'auth_forward_migration_probe';
const USER = 'a1111111-1111-4111-8111-111111111111';
const SESSION = 'a2222222-2222-4222-8222-222222222222';
describe('auth forward migration preserves existing data', () => {
  let db: DataSource;
  let runner: QueryRunner;
  const migration = new AlignAuthContract1789084800000();
  beforeAll(async () => {
    db = await createTestDataSource();
  });
  beforeEach(async () => {
    runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await runner.query(`SET LOCAL search_path TO "${SCHEMA}", public`);
    for (const item of MIGRATIONS) {
      if (item !== AlignAuthContract1789084800000) await new item().up(runner);
    }
    await runner.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
      USER,
      'migration@example.com',
      'preserved-password-hash',
    ]);
    await runner.query(
      "INSERT INTO refresh_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [SESSION, USER],
    );
    await runner.query("INSERT INTO categories (name) VALUES ('preserved category')");
    await runner.query("INSERT INTO tags (name) VALUES ('preserved tag')");
  });
  afterEach(async () => {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.query('SET search_path TO public');
    await runner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await runner.release();
  });
  afterAll(async () => {
    await db.destroy();
  });
  it('retains users and domain records while explicitly invalidating legacy sessions', async () => {
    await migration.up(runner);
    const rows = await db.query<
      { email: string; password_hash: string; token_hash: string; revoked_at: Date | null }[]
    >(
      'SELECT email, password_hash, token_hash, revoked_at FROM users JOIN refresh_sessions ON users.id = user_id WHERE users.id = $1',
      [USER],
      runner,
    );
    expect(rows[0]).toMatchObject({
      email: 'migration@example.com',
      password_hash: 'preserved-password-hash',
      token_hash: `legacy-revoked:${SESSION}`,
    });
    expect(rows[0]?.revoked_at).not.toBeNull();
    const names = await db.query<{ name: string }[]>(
      'SELECT name FROM categories UNION ALL SELECT name FROM tags ORDER BY name',
      [],
      runner,
    );
    expect(names.map((row) => row.name)).toEqual(['preserved category', 'preserved tag']);
    await runner.query('INSERT INTO categories (name) VALUES ($1)', ['c'.repeat(200)]);
    await runner.query('INSERT INTO tags (name) VALUES ($1)', ['t'.repeat(200)]);
  });
  it('fails explicitly before shrinking oversized existing emails', async () => {
    await runner.query('UPDATE users SET email = $1 WHERE id = $2', ['a'.repeat(255), USER]);
    await expect(migration.up(runner)).rejects.toThrow(
      'existing oversized emails require correction',
    );
  });
  it('keeps an existing Unicode account accessible and prevents duplicate registration', async () => {
    const password = 'legacy-password-123';
    const oldEmail = 'stra\u00dfe@example.com';
    await runner.query('UPDATE users SET email = $1, password_hash = $2 WHERE id = $3', [
      oldEmail,
      await hashPassword(password),
      USER,
    ]);
    await migration.up(runner);
    await runner.commitTransaction();
    const options = db.options;
    if (options.type !== 'postgres') throw new Error('PostgreSQL is required');
    const upgraded = new DataSource({ ...options, schema: SCHEMA });
    await upgraded.initialize();
    const settings = {
      secret: 'migration-test-jwt-secret-key-32-bytes',
      issuer: 'migration-test',
      audience: 'migration-test',
      accessExpiresSeconds: 900,
      refreshExpiresSeconds: 3600,
      leewaySeconds: 0,
    };
    const auth = new AuthController(upgraded, new TokenService(settings), settings);
    try {
      const loggedIn = await auth.login({
        data: { type: 'authCredentials', attributes: { email: oldEmail, password } },
      });
      expect(loggedIn.data.type).toBe('authTokens');
      await expect(
        auth.register({ data: { type: 'users', attributes: { email: oldEmail, password } } }),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
      const rows = await upgraded.query<{ id: string; email: string }[]>(
        `SELECT id, email FROM "${SCHEMA}".users`,
      );
      expect(rows).toEqual([{ id: USER, email: 'strasse@example.com' }]);
    } finally {
      await upgraded.destroy();
    }
  });
  it.each([false, true])(
    'detects collisions before any changes and rolls back (own transaction: %s)',
    async (ownsTransaction) => {
      await runner.query('UPDATE users SET email = $1 WHERE id = $2', [
        '  MIGRATION@EXAMPLE.COM  ',
        USER,
      ]);
      await runner.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, 'first'), ($2, 'second')",
        ['stra\u00dfe@example.com', 'strasse@example.com'],
      );
      const before = await db.query<{ id: string; email: string; password_hash: string }[]>(
        'SELECT id, email, password_hash FROM users ORDER BY id',
        [],
        runner,
      );
      if (ownsTransaction) {
        await runner.commitTransaction();
        await runner.query(`SET search_path TO "${SCHEMA}", public`);
      } else {
        await runner.query('SAVEPOINT before_email_upgrade');
      }
      await expect(migration.up(runner)).rejects.toThrow('email normalization collision');
      const unchanged = await db.query<{ id: string; email: string; password_hash: string }[]>(
        'SELECT id, email, password_hash FROM users ORDER BY id',
        [],
        runner,
      );
      expect(unchanged).toEqual(before);
      if (ownsTransaction) expect(runner.isTransactionActive).toBe(false);
      else await runner.query('ROLLBACK TO SAVEPOINT before_email_upgrade');
      const after = await db.query<{ id: string; email: string; password_hash: string }[]>(
        'SELECT id, email, password_hash FROM users ORDER BY id',
        [],
        runner,
      );
      expect(after).toEqual(before);
      const sessions = await db.query<{ revoked_at: Date | null }[]>(
        'SELECT revoked_at FROM refresh_sessions WHERE id = $1',
        [SESSION],
        runner,
      );
      expect(sessions).toEqual([{ revoked_at: null }]);
    },
  );
  it('rejects emails that exceed the limit only after Unicode case folding', async () => {
    await runner.query('UPDATE users SET email = $1 WHERE id = $2', [
      '\u00df'.repeat(128) + '@example.com',
      USER,
    ]);
    await expect(migration.up(runner)).rejects.toThrow(
      'existing oversized emails require correction',
    );
  });
  it('requires an explicit status on direct database inserts', async () => {
    await migration.up(runner);
    await expect(
      runner.query("INSERT INTO examples (title, score) VALUES ('missing status', 0)"),
    ).rejects.toThrow(/null value in column "status".*violates not-null constraint/);
  });

  it('preserves existing statuses and restores the historical default on rollback', async () => {
    await runner.query(
      "INSERT INTO examples (title, status, score) VALUES ('preserved status', 'active', 12)",
    );
    await migration.up(runner);
    const existing = await db.query<{ status: string }[]>(
      "SELECT status FROM examples WHERE title = 'preserved status'",
      [],
      runner,
    );
    expect(existing).toEqual([{ status: 'active' }]);
    await migration.down(runner);
    const restored = await db.query<{ status: string }[]>(
      "INSERT INTO examples (title, score) VALUES ('old default', 0) RETURNING status",
      [],
      runner,
    );
    expect(restored).toEqual([{ status: 'draft' }]);
  });
});
