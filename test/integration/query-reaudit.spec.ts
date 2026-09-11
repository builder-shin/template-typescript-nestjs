import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';
import { acquireCommitLock } from '../db/fixture.js';
import type { CommitLockHandle } from '../db/fixture.js';

interface Body {
  data: { id: string; attributes: { status: string } }[];
  links: Record<string, string | null>;
  errors: { code: string; source: { parameter: string } }[];
}

describe('query SQL and HTTP re-audit', () => {
  let app: INestApplication<Server>;
  let db: DataSource;
  let lock: CommitLockHandle;
  const title = `query-reaudit-${randomUUID()}`;
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const api = (): ReturnType<typeof request> => request(app.getHttpServer());
  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    lock = await acquireCommitLock(db);
    for (const [index, id] of ids.entries()) {
      await db.query(
        'INSERT INTO examples (id, title, status, score, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)',
        [
          id,
          title,
          ['draft', 'active', 'archived'][Math.floor(index / 2)],
          Math.floor(index / 2),
          `2026-01-01T00:00:00.${String(123450 + index)}Z`,
        ],
      );
    }
  });
  afterAll(async () => {
    await db.query('DELETE FROM examples WHERE id = ANY($1)', [ids]);
    await lock.release();
    await app.close();
  });

  it.each(
    ['title', 'score', 'status', 'createdAt', 'updatedAt'].flatMap((sort) => [sort, `-${sort}`]),
  )('round trips every %s cursor link in both directions', async (sort) => {
    const response = await api()
      .get('/api/v1/examples')
      .query({ sort, 'filter[title]': title, 'page[size]': '100' })
      .expect(200);
    const expected = (response.body as Body).data;
    if (sort.replace('-', '') === 'status')
      expect(expected.map((row) => row.attributes.status)).toEqual(
        sort === 'status'
          ? ['draft', 'draft', 'active', 'active', 'archived', 'archived']
          : ['archived', 'archived', 'active', 'active', 'draft', 'draft'],
      );
    for (const direction of ['after', 'before']) {
      let next: string | null =
        `/api/v1/examples?${new URLSearchParams({ sort, 'filter[title]': title, [`page[${direction}]`]: '', 'page[size]': '1' }).toString()}`;
      const rows: Body['data'] = [];
      for (let count = 0; next !== null && count < 8; count += 1) {
        const current = await api()
          .get(new URL(next, 'http://local').pathname + new URL(next, 'http://local').search)
          .expect(200);
        const body = current.body as Body;
        rows.push(...body.data);
        next = body.links[direction === 'after' ? 'next' : 'prev'] ?? null;
      }
      expect(rows).toEqual(direction === 'after' ? expected : [...expected].reverse());
    }
  });

  it.each(
    ['title', 'score', 'status', 'createdAt', 'updatedAt'].flatMap((sort) => [sort, `-${sort}`]),
  )('validates typed %s cursor scalars before SQL', async (sort) => {
    const response = await api()
      .get('/api/v1/examples')
      .query({ sort, 'filter[title]': title, 'page[after]': '', 'page[size]': '1' })
      .expect(200);
    const next = (response.body as Body).links.next;
    if (!next) throw new Error('Missing cursor link');
    const link = new URL(next, 'http://local');
    const raw = link.searchParams.get('page[after]');
    if (!raw) throw new Error('Missing cursor');
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { values: unknown[] };
    const invalid: unknown[] = [null, true, 1, {}, []];
    if (sort.includes('score')) invalid.push('2147483648', '-2147483649', 'not-a-number');
    if (sort.includes('At'))
      invalid.push('0000-01-01T00:00:00Z', '0001-01-01T00:00:00+01:00', '2026-02-30T00:00:00Z');
    if (sort.includes('status')) invalid.push('unknown');
    for (const direction of ['after', 'before'])
      for (const value of invalid) {
        payload.values[0] = value;
        const cursor = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const rejected = await api()
          .get('/api/v1/examples')
          .query({ sort, [`page[${direction}]`]: cursor })
          .expect(400);
        expect((rejected.body as Body).errors[0]).toMatchObject({
          code: 'INVALID_PAGE',
          source: { parameter: `page[${direction}]` },
        });
      }
  });
});
