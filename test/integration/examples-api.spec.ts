import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';

/**
 * Example API의 계약을 실제 HTTP와 실제 PostgreSQL로 고정한다.
 *
 * 앞선 태스크들은 조각을 각자 테스트했다. "선언 하나로 라우트가 생기고 실제 요청이
 * 실제 DB를 바꾼다"를 증명하는 것은 이 파일뿐이다 — 스펙 15장이 모델 mock이나 DB 없는
 * 컨트롤러 단위 테스트로 계약을 대체하지 않는다고 정한 자리다.
 */

const VENDOR = 'application/vnd.api+json';
const MISSING = '0195c1a0-0000-7000-8000-0000000009ff';

interface ErrorBody {
  errors: { code: string; status: string; title: string; source?: { pointer?: string } }[];
}

interface ResourceBody {
  data: {
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data?: unknown }>;
    links: { self: string };
  };
  included?: { type: string; id: string }[];
}

interface CollectionBody {
  data: { id: string; attributes: Record<string, unknown> }[];
  links: { self: string; next?: string; last?: string };
  meta?: { totalCount: number };
}

describe('Examples API', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;

  const api = (): ReturnType<typeof request> => request(app.getHttpServer());

  /**
   * JSON:API 헤더를 갖춘 POST.
   *
   * `async`를 붙이지 않는다. supertest의 `Test`는 그 자체로 `Promise<Response>`라
   * 그대로 돌려주면 되고, `async`로 감싸면 `await`가 없어 `require-await`에 걸린다.
   */
  function createExample(
    attributes: Record<string, unknown>,
    relationships?: unknown,
  ): Promise<Response> {
    return api()
      .post('/api/v1/examples')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            attributes,
            ...(relationships === undefined ? {} : { relationships }),
          },
        }),
      );
  }

  /** 분류 한 행을 만들고 id를 돌려준다. */
  async function seedCategory(): Promise<string> {
    const rows = await dataSource.query<{ id: string }[]>(
      `INSERT INTO categories (name) VALUES ('분류') RETURNING id`,
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('분류를 만들지 못했다');
    }
    return id;
  }

  /** 라벨 두 행을 만들고 id를 돌려준다. */
  async function seedTags(): Promise<string[]> {
    const rows = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('ㄱ'), ('ㄴ') RETURNING id`,
    );
    return rows.map((row) => row.id);
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterEach(async () => {
    // TRUNCATE가 아니라 DELETE다 — 행 수준 잠금만 잡아 다른 워커를 막지 않고,
    // 커밋되지 않은 다른 워커의 행은 보이지 않아 지워지지도 않는다.
    await dataSource.query('DELETE FROM example_tags');
    await dataSource.query('DELETE FROM examples');
    await dataSource.query('DELETE FROM categories');
    await dataSource.query('DELETE FROM tags');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/examples', () => {
    it('201과 Location, 그리고 자원 문서를 낸다', async () => {
      const response = await createExample({ title: '제목' });

      expect(response.status).toBe(201);
      expect(response.headers['content-type']).toBe(VENDOR);
      const body = response.body as ResourceBody;
      expect(response.headers.location).toBe(`/api/v1/examples/${body.data.id}`);
      expect(body.data.type).toBe('examples');
      expect(body.data.attributes.title).toBe('제목');
      // DB 기본값이 응답에 반영돼야 한다.
      expect(body.data.attributes.status).toBe('draft');
      expect(body.data.links.self).toBe(`/api/v1/examples/${body.data.id}`);
    });

    it('검증 실패를 422로, 틀린 필드를 모두 낸다', async () => {
      const response = await createExample({ title: '', status: 'unknown' });

      expect(response.status).toBe(422);
      const body = response.body as ErrorBody;
      expect(body.errors).toHaveLength(2);
      expect(body.errors.map((error) => error.source?.pointer).sort()).toEqual([
        '/data/attributes/status',
        '/data/attributes/title',
      ]);
    });

    it('타입이 다르면 409 TYPE_MISMATCH다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'others', attributes: { title: '제목' } } }));

      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('TYPE_MISMATCH');
    });

    it('클라이언트가 만든 id를 403으로 거부한다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(
          JSON.stringify({
            data: { type: 'examples', id: MISSING, attributes: { title: '제목' } },
          }),
        );

      expect(response.status).toBe(403);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('CLIENT_GENERATED_ID_UNSUPPORTED');
    });

    it('to-one 관계를 함께 만든다', async () => {
      const categoryId = await seedCategory();

      const response = await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: categoryId } } },
      );

      expect(response.status).toBe(201);
      expect((response.body as ResourceBody).data.relationships.category?.data).toEqual({
        type: 'categories',
        id: categoryId,
      });
    });

    it('to-many 관계를 함께 만든다', async () => {
      // to-one과 다른 코드 경로다 — 해석 결과가 배열로 엔티티에 실리고 조인 테이블에
      // 행이 생긴다. to-one만 확인하면 그 경로가 통째로 비어 있게 된다.
      const tags = await seedTags();

      const response = await createExample(
        { title: '제목' },
        { tags: { data: tags.map((tagId) => ({ type: 'tags', id: tagId })) } },
      );

      expect(response.status).toBe(201);
      const linkage = (response.body as ResourceBody).data.relationships.tags?.data;
      expect(linkage).toHaveLength(2);

      const rows = await dataSource.query<{ count: string }[]>('SELECT COUNT(*) FROM example_tags');
      expect(rows[0]?.count).toBe('2');
    });

    it('없는 관계 대상은 404 RELATIONSHIP_RESOURCE_NOT_FOUND다', async () => {
      const response = await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: MISSING } } },
      );

      expect(response.status).toBe(404);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
    });

    it('관계 대상을 못 찾으면 자원도 만들지 않는다', async () => {
      // 트랜잭션이 실제로 걸려 있는지 확인한다. 자원만 남고 관계가 비면
      // 클라이언트가 만든 적 없는 자원이 생긴다.
      await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: MISSING } } },
      );
      const rows = await dataSource.query<{ count: string }[]>('SELECT COUNT(*) FROM examples');
      expect(rows[0]?.count).toBe('0');
    });
  });

  describe('GET /api/v1/examples', () => {
    it('빈 컬렉션도 data가 배열이다', async () => {
      const response = await api().get('/api/v1/examples').set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as CollectionBody).data).toEqual([]);
    });

    it('목록과 페이지 링크를 낸다', async () => {
      await createExample({ title: 'ㄱ' });
      await createExample({ title: 'ㄴ' });

      const response = await api().get('/api/v1/examples?page[size]=1').set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.data).toHaveLength(1);
      expect(body.links.next).toContain('page[number]=2');
      expect(body.meta).toBeUndefined();
    });

    it('totals를 요청하면 총 개수와 last 링크를 낸다', async () => {
      await createExample({ title: 'ㄱ' });
      await createExample({ title: 'ㄴ' });

      const response = await api()
        .get('/api/v1/examples?page[size]=1&page[totals]=true')
        .set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.meta?.totalCount).toBe(2);
      expect(body.links.last).toContain('page[number]=2');
    });

    it('filter와 sort를 적용한다', async () => {
      await createExample({ title: 'ㄱ', status: 'published' });
      await createExample({ title: 'ㄴ' });

      const response = await api()
        .get('/api/v1/examples?filter[status]=published&sort=title')
        .set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.attributes.title).toBe('ㄱ');
    });

    it('알 수 없는 질의 파라미터를 400으로 거부한다', async () => {
      const response = await api().get('/api/v1/examples?q=검색').set('Accept', VENDOR);
      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('GET /api/v1/examples/{id}', () => {
    it('자원 하나를 낸다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api().get(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as ResourceBody).data.id).toBe(id);
    });

    it('include로 관계 자원을 함께 낸다', async () => {
      const categoryId = await seedCategory();
      const created = await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: categoryId } } },
      );
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}?include=category`)
        .set('Accept', VENDOR);
      expect(response.body as ResourceBody).toHaveProperty('included');
      expect((response.body as ResourceBody).included?.[0]?.type).toBe('categories');
    });

    it('없는 자원은 404다', async () => {
      const response = await api().get(`/api/v1/examples/${MISSING}`).set('Accept', VENDOR);
      expect(response.status).toBe(404);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('모양이 깨진 id도 404다', async () => {
      // uuid 컬럼에 uuid가 아닌 값을 넣으면 드라이버가 문법 오류를 낸다. 없는 자원을
      // 물은 것이므로 500이 아니라 404가 맞다.
      const response = await api().get('/api/v1/examples/not-a-uuid').set('Accept', VENDOR);
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/examples/{id}', () => {
    it('보낸 필드만 바꾼다', async () => {
      const created = await createExample({ title: '제목', body: '본문' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'examples', id, attributes: { title: '새 제목' } } }));

      expect(response.status).toBe(200);
      const body = response.body as ResourceBody;
      expect(body.data.attributes.title).toBe('새 제목');
      // 보내지 않은 필드는 그대로여야 한다. 이것이 스펙 7.1의 계약이다.
      expect(body.data.attributes.body).toBe('본문');
    });

    it('null로 보낸 필드는 비운다', async () => {
      const created = await createExample({ title: '제목', body: '본문' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'examples', id, attributes: { body: null } } }));

      expect((response.body as ResourceBody).data.attributes.body).toBeNull();
    });

    it('경로와 문서의 id가 다르면 409 ID_MISMATCH다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'examples', id: MISSING, attributes: {} } }));

      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('ID_MISMATCH');
    });
  });

  describe('DELETE /api/v1/examples/{id}', () => {
    it('204를 내고 실제로 지운다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api().delete(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(response.status).toBe(204);
      // 204는 본문이 없다. 라우트 등록기가 붙인 상태 코드가 실제로 나가는지 함께 본다.
      expect(response.text).toBe('');

      const after = await api().get(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(after.status).toBe(404);
    });
  });

  describe('관계 라우트', () => {
    it('to-many linkage를 읽는다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as { data: unknown[] }).data).toEqual([]);
    });

    it('to-many linkage를 교체하고 204를 낸다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();

      const response = await api()
        .patch(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: tags.map((tagId) => ({ type: 'tags', id: tagId })) }));

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('to-many에 더하고 뺀다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();
      const [first, second] = tags;
      if (first === undefined || second === undefined) {
        throw new Error('라벨을 만들지 못했다');
      }

      // POST는 204다 — 스펙 6.3의 관계 쓰기는 본문을 돌려주지 않는다.
      const added = await api()
        .post(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: [{ type: 'tags', id: first }] }));
      expect(added.status).toBe(204);
      expect(added.text).toBe('');

      const between = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect((between.body as { data: unknown[] }).data).toHaveLength(1);

      const removed = await api()
        .delete(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: [{ type: 'tags', id: first }] }));
      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');

      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown[] }).data).toEqual([]);
    });

    it('to-one linkage를 교체하고 해제한다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const categoryId = await seedCategory();

      const replaced = await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'categories', id: categoryId } }));
      expect(replaced.status).toBe(204);
      expect(replaced.text).toBe('');

      const between = await api()
        .get(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR);
      expect((between.body as { data: unknown }).data).toEqual({
        type: 'categories',
        id: categoryId,
      });

      const cleared = await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: null }));
      expect(cleared.status).toBe(204);
      expect(cleared.text).toBe('');

      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown }).data).toBeNull();
    });

    it('related 자원 경로가 연결된 자원을 낸다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();
      await api()
        .patch(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: tags.map((tagId) => ({ type: 'tags', id: tagId })) }))
        .expect(204);

      const response = await api().get(`/api/v1/examples/${id}/tags`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      const body = response.body as CollectionBody;
      expect(body.data).toHaveLength(2);
      // 스펙 8.2: to-many 관계 URL은 총 개수를 언제나 낸다.
      expect(body.meta?.totalCount).toBe(2);
    });

    it('to-one related 경로가 연결된 자원을 낸다', async () => {
      // 400 경로만 확인하면 이 라우트의 성공 경로가 통째로 비어 있게 된다 —
      // 라우트는 열려 있는데 무엇을 내는지는 아무것도 고정하지 않은 상태가 된다.
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const categoryId = await seedCategory();
      await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'categories', id: categoryId } }))
        .expect(204);

      const response = await api().get(`/api/v1/examples/${id}/category`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      const body = response.body as { data: { type: string; id: string } };
      expect(body.data.type).toBe('categories');
      expect(body.data.id).toBe(categoryId);
    });

    it('연결이 없으면 to-one related 경로가 null을 낸다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api().get(`/api/v1/examples/${id}/category`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as { data: unknown }).data).toBeNull();
    });

    it('to-one related 경로는 조회 파라미터를 거부한다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}/category?include=x`)
        .set('Accept', VENDOR);
      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('협상', () => {
    it('Accept가 맞지 않으면 406이다', async () => {
      const response = await api().get('/api/v1/examples').set('Accept', 'text/html');
      expect(response.status).toBe(406);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('NOT_ACCEPTABLE');
    });

    it('Content-Type이 맞지 않으면 415다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ data: { type: 'examples', attributes: { title: '제목' } } }));
      expect(response.status).toBe(415);
    });

    it('오류도 vendor Content-Type으로 나간다', async () => {
      const response = await api().get(`/api/v1/examples/${MISSING}`).set('Accept', VENDOR);
      expect(response.headers['content-type']).toBe(VENDOR);
    });

    it('Accept-Language를 따라 오류 메시지가 바뀐다', async () => {
      const korean = await api().get(`/api/v1/examples/${MISSING}`).set('Accept', VENDOR);
      const english = await api()
        .get(`/api/v1/examples/${MISSING}`)
        .set('Accept', VENDOR)
        .set('Accept-Language', 'en');
      expect((korean.body as ErrorBody).errors[0]?.title).not.toBe(
        (english.body as ErrorBody).errors[0]?.title,
      );
    });
  });
});
