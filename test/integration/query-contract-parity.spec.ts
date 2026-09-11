import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TokenService } from '../../src/app/auth/tokens.js';
import { encodeCursor } from '../../src/app/jsonapi/cursor.js';
import { User } from '../../src/app/models/user.entity.js';
import { createTestApp } from '../app-factory.js';
import { acquireCommitLock } from '../db/fixture.js';
import type { CommitLockHandle } from '../db/fixture.js';

const VENDOR = 'application/vnd.api+json';
interface Body {
  jsonapi: { version: string };
  data: {
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data: unknown }>;
  }[];
  links: Record<string, string | null>;
  errors: { code: string; source: Record<string, string> }[];
}

describe('FastAPI query and document contract', () => {
  let app: INestApplication<Server> | undefined;
  let db: DataSource;
  let lock: CommitLockHandle | undefined;
  let token: string;
  const firstId = randomUUID();
  const ids = [firstId, randomUUID()];
  const category = randomUUID();
  const tag = randomUUID();
  const email = `query-parity-${randomUUID()}@example.com`;
  const api = (): ReturnType<typeof request> => {
    if (app === undefined) throw new Error('Application was not initialized');
    return request(app.getHttpServer());
  };
  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    lock = await acquireCommitLock(db);
    await db.query('INSERT INTO categories (id, name) VALUES ($1, $2)', [
      category,
      'Parity category',
    ]);
    await db.query('INSERT INTO tags (id, name) VALUES ($1, $2)', [tag, 'Parity tag']);
    for (const [index, id] of ids.entries()) {
      await db.query(
        'INSERT INTO examples (id, title, status, score, category_id, created_at, updated_at) VALUES ($1, $2, $3, 10, $4, $5, $5)',
        [
          id,
          'MiXeD-Parity',
          'draft',
          category,
          `2026-01-01T00:00:00.${index === 0 ? '123456' : '123200'}Z`,
        ],
      );
      await db.query('INSERT INTO example_tags (example_id, tag_id) VALUES ($1, $2)', [id, tag]);
    }
    const attributes = { email, password: 'query-parity-password-1234' };
    await api()
      .post('/api/v1/auth/register')
      .set('Content-Type', VENDOR)
      .send(JSON.stringify({ data: { type: 'users', attributes } }))
      .expect(201);
    const user = await db.getRepository(User).findOneByOrFail({ email });
    token = app.get(TokenService).signAccessToken(user.id);
  });
  afterAll(async () => {
    if (app !== undefined) {
      await db.query('DELETE FROM examples WHERE id = ANY($1)', [ids]);
      await db.query('DELETE FROM categories WHERE id = $1', [category]);
      await db.query('DELETE FROM tags WHERE id = $1', [tag]);
      await db.query('DELETE FROM users WHERE email = $1', [email]);
    }
    await lock?.release();
    await app?.close();
  });
  it.each(['post', 'patch', 'put', 'delete'] as const)(
    'rejects query parameters on %s writes before mutation',
    async (method) => {
      const path = method === 'post' ? '/api/v1/examples' : `/api/v1/examples/${firstId}`;
      const result = await api()
        [method](`${path}?include=`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', VENDOR)
        .send({
          data: {
            type: 'examples',
            ...(method === 'post' ? {} : { id: firstId }),
            attributes: { title: 'Ignored', status: 'draft', score: 10 },
          },
        });
      expect(result.status).toBe(400);
      expect((result.body as Body).errors[0]).toMatchObject({
        code: 'INVALID_QUERY_PARAMETER',
        source: { parameter: 'include' },
      });
    },
  );
  it.each(['get', 'post', 'patch', 'delete'] as const)(
    'rejects query parameters on %s linkage routes',
    async (method) => {
      const result = await api()
        [method](`/api/v1/examples/${firstId}/relationships/tags?include=`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', VENDOR)
        .send({ data: [] });
      expect(result.status).toBe(400);
      expect((result.body as Body).errors[0]).toMatchObject({
        code: 'INVALID_QUERY_PARAMETER',
        source: { parameter: 'include' },
      });
    },
  );
  it.each(['post', 'patch', 'put'] as const)(
    'validates %s body before unknown query and query before semantic type',
    async (method) => {
      const path = method === 'post' ? '/api/v1/examples' : `/api/v1/examples/${firstId}`;
      const call = (data: unknown): request.Test =>
        api()
          [method](`${path}?include=`)
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', VENDOR)
          .send({ data });
      expect(
        (await call({ type: 'examples', id: firstId, attributes: { score: 'bad' } })).status,
      ).toBe(422);
      const semantic = await call({
        type: 'wrong',
        ...(method === 'post' ? {} : { id: firstId }),
        attributes: { title: 'Ignored', score: 1, status: 'draft' },
      });
      expect(semantic.status).toBe(400);
      expect((semantic.body as Body).errors[0]?.source).toEqual({ parameter: 'include' });
      const rows = await db.getRepository('Example').findBy({ id: firstId });
      expect(rows).toHaveLength(1);
    },
  );
  it.each(['after', 'before'])(
    'traverses PostgreSQL microseconds with page[%s]',
    async (direction) => {
      let url = `/api/v1/examples?filter[title]=MiXeD-Parity&page[${direction}]=&page[size]=1`;
      const seen: string[] = [];
      for (let round = 0; round < 3; round += 1) {
        const response = await api().get(url).expect(200);
        const body = response.body as Body;
        seen.push(...body.data.map((resource) => resource.id));
        const next = body.links[direction === 'after' ? 'next' : 'prev'];
        if (!next) break;
        url = next;
      }
      expect(seen).toEqual(direction === 'after' ? ids : [...ids].reverse());
    },
  );
  it.each(['3.5', '2147483648', '-2147483649', '9'.repeat(310)])(
    'rejects invalid integer filter %s',
    async (value) => {
      const response = await api()
        .get('/api/v1/examples')
        .query({ 'filter[score][gte]': value })
        .expect(400);
      expect((response.body as Body).errors[0]).toMatchObject({
        code: 'INVALID_FILTER',
        source: { parameter: 'filter[score][gte]' },
      });
    },
  );
  it.each(['9'.repeat(36), '9223372036854775807'])('rejects overflowing page %s', async (value) => {
    await api()
      .get('/api/v1/examples')
      .query({ 'page[number]': value, 'page[size]': '100' })
      .expect(400);
  });
  it('clamps the requested size', async () => {
    const response = await api().get('/api/v1/examples?page[size]=200').expect(200);
    expect(
      new URL((response.body as Body).links.self ?? '', 'http://test').searchParams.get(
        'page[size]',
      ),
    ).toBe('100');
  });
  it('accepts the last portable offset and rejects the following page', async () => {
    await api().get('/api/v1/examples?page[number]=9007199254740992&page[size]=1').expect(200);
    const response = await api()
      .get('/api/v1/examples?page[number]=9007199254740993&page[size]=1')
      .expect(400);
    expect((response.body as Body).errors[0]?.source).toEqual({ parameter: 'page[number]' });
  });
  it('clamps a valid int64 size before checking the offset', async () => {
    const response = await api().get('/api/v1/examples?page[size]=9223372036854775807').expect(200);
    expect(
      new URL((response.body as Body).links.self ?? '', 'http://test').searchParams.get(
        'page[size]',
      ),
    ).toBe('100');
    await api().get('/api/v1/examples?page[size]=9223372036854775808').expect(400);
  });
  it('matches contains case sensitively', async () => {
    const response = await api()
      .get('/api/v1/examples?filter[title][contains]=mixed-parity')
      .expect(200);
    expect((response.body as Body).data).toEqual([]);
  });
  it.each([`${VENDOR};q=0`, `${VENDOR};q=0, */*;q=1`, `${VENDOR};charset=utf-8, */*`])(
    'honors Accept specificity: %s',
    async (accept) => {
      const response = await api().get('/api/v1/examples').set('Accept', accept).expect(406);
      expect((response.body as Body).errors[0]?.source).toEqual({ header: 'Accept' });
    },
  );
  it('accepts Content-Type profile', async () => {
    await api()
      .patch(`/api/v1/examples/${firstId}`)
      .set('Content-Type', `${VENDOR};profile="https://example.test/p;a,b"`)
      .set('Authorization', `Bearer ${token}`)
      .send(JSON.stringify({ data: { type: 'examples', id: firstId, attributes: {} } }))
      .expect(200);
  });
  it('reports the before cursor parameter and version in errors', async () => {
    const response = await api().get('/api/v1/examples?page[before]=!').expect(400);
    const body = response.body as Body;
    expect(body.errors[0]?.source).toEqual({ parameter: 'page[before]' });
    expect(body.jsonapi).toEqual({ version: '1.1' });
  });
  it.each([
    {
      sort: undefined,
      signature: '-createdAt,id',
      values: ['not-a-date', '00000000-0000-4000-8000-000000000003'],
    },
    {
      sort: undefined,
      signature: '-createdAt,id',
      values: ['2026-01-01T00:00:00.123456Z', 'not-a-uuid'],
    },
    {
      sort: 'score',
      signature: 'score,id',
      values: ['3.5', '00000000-0000-4000-8000-000000000003'],
    },
    {
      sort: 'score',
      signature: 'score,id',
      values: ['2147483648', '00000000-0000-4000-8000-000000000003'],
    },
    {
      sort: 'status',
      signature: 'status,id',
      values: ['bad-status', '00000000-0000-4000-8000-000000000003'],
    },
  ])('rejects typed cursor values before SQL: $values', async ({ sort, signature, values }) => {
    for (const direction of ['after', 'before']) {
      const response = await api()
        .get('/api/v1/examples')
        .query({
          [`page[${direction}]`]: encodeCursor(signature, values),
          ...(sort === undefined ? {} : { sort }),
        })
        .expect(400);
      expect((response.body as Body).errors[0]).toMatchObject({
        code: 'INVALID_PAGE',
        source: { parameter: `page[${direction}]` },
      });
    }
  });
  it('emits exact microseconds, linkage without include, and nullable encoded links', async () => {
    const response = await api().get('/api/v1/examples?filter[title]=MiXeD-Parity').expect(200);
    const body = response.body as Body;
    expect(body.jsonapi).toEqual({ version: '1.1' });
    expect(body.data[0]?.attributes.createdAt).toBe('2026-01-01T00:00:00.123456+00:00');
    expect(body.data[0]?.relationships.category?.data).toEqual({
      type: 'exampleCategories',
      id: category,
    });
    expect(body.data[0]?.relationships.tags?.data).toEqual([{ type: 'exampleTags', id: tag }]);
    expect(body.links).toMatchObject({ prev: null, next: null, last: null });
    expect(body.links.self).toContain('page%5Bnumber%5D=1');
  });
  it.each([
    {
      data: [
        { type: 'exampleTags', id: tag },
        { type: 'exampleTags', id: tag },
      ],
      status: 400,
      code: 'INVALID_JSONAPI_DOCUMENT',
    },
    {
      data: [{ type: 'exampleTags', id: tag, extra: true }],
      status: 422,
      code: 'VALIDATION_ERROR',
    },
  ])('validates relationship documents: $code', async ({ data, status, code }) => {
    const response = await api()
      .patch(`/api/v1/examples/${firstId}/relationships/tags`)
      .set('Content-Type', VENDOR)
      .set('Authorization', `Bearer ${token}`)
      .send(JSON.stringify({ data }))
      .expect(status);
    expect((response.body as Body).errors[0]?.code).toBe(code);
    expect((response.body as Body).errors[0]?.source).toEqual({
      pointer: status === 400 ? '/data/1/id' : '/data/0/extra',
    });
  });
  it('requires a PUT body id', async () => {
    const response = await api()
      .put(`/api/v1/examples/${firstId}`)
      .set('Content-Type', VENDOR)
      .set('Authorization', `Bearer ${token}`)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            attributes: { title: 'MiXeD-Parity', status: 'draft', score: 10 },
          },
        }),
      )
      .expect(422);
    expect((response.body as Body).errors[0]?.code).toBe('VALIDATION_ERROR');
    expect((response.body as Body).errors[0]?.source).toEqual({ pointer: '/data/id' });
  });
  it('rejects totals on related lists while its own pagination links remain usable', async () => {
    const path = `/api/v1/examples/${firstId}/tags`;
    const rejected = await api().get(`${path}?page[totals]=true`).expect(400);
    expect((rejected.body as Body).errors[0]).toMatchObject({
      code: 'INVALID_PAGE',
      source: { parameter: 'page[totals]' },
    });
    const response = await api().get(path);
    expect(response.body).toHaveProperty('data');
    expect(response.status).toBe(200);
    const body = response.body as Body;
    expect(body.links.self).not.toContain('totals');
    expect(body.links.last).not.toBeNull();
    await api()
      .get(body.links.self ?? '')
      .expect(200);
  });
  it.each([
    { suffix: '', parameter: 'filter', code: 'INVALID_FILTER' },
    { suffix: '', parameter: 'sort[extra]', code: 'INVALID_SORT' },
    { suffix: '', parameter: 'include[extra]', code: 'INVALID_INCLUDE' },
    { suffix: '', parameter: 'page[offset]', code: 'INVALID_PAGE' },
    { suffix: `/${firstId}`, parameter: 'sort', code: 'INVALID_SORT' },
    { suffix: `/${firstId}`, parameter: 'filter[status]', code: 'INVALID_FILTER' },
    { suffix: `/${firstId}`, parameter: 'page[size]', code: 'INVALID_PAGE' },
    { suffix: `/${firstId}/tags`, parameter: 'filter[status]', code: 'INVALID_FILTER' },
    { suffix: `/${firstId}/tags`, parameter: 'sort', code: 'INVALID_SORT' },
    { suffix: `/${firstId}/tags`, parameter: 'include', code: 'INVALID_INCLUDE' },
    { suffix: `/${firstId}/category`, parameter: 'page[number]', code: 'INVALID_QUERY_PARAMETER' },
  ])('classifies unsupported $parameter on $suffix', async ({ suffix, parameter, code }) => {
    const response = await api()
      .get(`/api/v1/examples${suffix}`)
      .query({ [parameter]: 'x' })
      .expect(400);
    expect((response.body as Body).errors[0]).toMatchObject({ code, source: { parameter } });
  });
});
