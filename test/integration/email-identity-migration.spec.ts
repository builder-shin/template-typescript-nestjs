import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { requireTestDatabaseUrl } from '../db/fixture.js';
import { NormalizeEmailIdentities1789124400000 } from '../../src/db/migrations/20260911110000-normalize-email-identities.js';
import type { QueryRunner } from 'typeorm';

describe('reversible email identity migration', () => {
  let db: DataSource;
  let runner: QueryRunner;
  const migration = new NormalizeEmailIdentities1789124400000();
  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url: requireTestDatabaseUrl() }).initialize();
  });
  beforeEach(async () => {
    runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('CREATE SCHEMA email_identity_probe');
    await runner.query('SET LOCAL search_path TO email_identity_probe');
    await runner.query(
      'CREATE TABLE users (id uuid PRIMARY KEY, email varchar(254) UNIQUE NOT NULL)',
    );
  });
  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });
  afterAll(async () => {
    await db.destroy();
  });
  const insert = async (email: string): Promise<string> => {
    const id = randomUUID();
    await runner.query('INSERT INTO users VALUES ($1,$2)', [id, email]);
    return id;
  };
  const emailOf = async (id: string): Promise<string | undefined> =>
    (
      await runner.dataSource.query<{ email: string }[]>(
        'SELECT email FROM users WHERE id=$1',
        [id],
        runner,
      )
    )[0]?.email;
  it('normalizes legacy NFC/IDNA/casefold and exactly restores original representations', async () => {
    const original = 'Cafe\u0301@XN--BCHER-KVA.EXAMPLE.COM';
    const id = await insert(original);
    await migration.up(runner);
    expect(await emailOf(id)).toBe('café@bücher.example.com');
    await migration.down(runner);
    expect(await emailOf(id)).toBe(original);
  });
  it.each([
    ['A@example.com', 'a@example.com'],
    ['a@xn--bcher-kva.example.com', 'a@bücher.example.com'],
    ['Straße@example.com', 'strasse@example.com'],
    ['cafe\u0301@example.com', 'café@example.com'],
  ])('aborts collisions before touching accounts %s', async (first, second) => {
    const id = await insert(first);
    await insert(second);
    await expect(migration.up(runner)).rejects.toThrow(/collision/);
    expect(await emailOf(id)).toBe(first);
  });
  it('aborts legacy addresses rejected by the new login syntax', async () => {
    const id = await insert('legacy@example.test');
    await expect(migration.up(runner)).rejects.toThrow(/correction/);
    expect(await emailOf(id)).toBe('legacy@example.test');
  });
  it('preserves later email edits and deletions during rollback', async () => {
    const changed = await insert('Changed@example.com');
    const deleted = await insert('Deleted@example.com');
    await migration.up(runner);
    await runner.query('UPDATE users SET email=$1 WHERE id=$2', ['new@example.com', changed]);
    await runner.query('DELETE FROM users WHERE id=$1', [deleted]);
    await migration.down(runner);
    expect(await emailOf(changed)).toBe('new@example.com');
    expect(await emailOf(deleted)).toBeUndefined();
  });
  it('aborts a rollback collision without changing accounts', async () => {
    const id = await insert('Original@example.com');
    await migration.up(runner);
    await insert('Original@example.com');
    await expect(migration.down(runner)).rejects.toThrow(/collision/);
    expect(await emailOf(id)).toBe('original@example.com');
  });
});
