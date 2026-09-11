import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';
import { acquireCommitLock } from '../db/fixture.js';
import type { CommitLockHandle } from '../db/fixture.js';

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
  errors: {
    code: string;
    status: string;
    title: string;
    detail: string;
    source?: { pointer?: string; parameter?: string };
  }[];
}

interface ResourceBody {
  data: {
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data?: unknown }>;
    links: { self: string };
  };
  included?: { type: string; id: string; links?: { self: string } }[];
}

interface CollectionBody {
  data: { id: string; attributes: Record<string, unknown> }[];
  links: { self: string; next?: string; last?: string };
  meta?: { totalCount: number };
}

/** 로그인 응답. access token만 꺼내 쓴다. */
interface TokensBody {
  data: { attributes: Record<string, unknown> };
}

describe('Examples API', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  // 이 스위트가 쓰기에 쓰는 access token. 읽기 요청에는 절대 붙이지 않는다 — 읽기가
  // 공개로 남아 있는지가 이 파일이 지켜야 할 계약이고, 전부에 붙이면 그 계약이
  // 검증되지 않는다.
  let accessToken: string;
  // examples-put.spec.ts와의 상호 배제 손잡이. 자세한 이유는 fixture.ts의
  // `acquireCommitLock` 문서 주석 참고 — 이 스위트가 실제로 커밋하는 유일한 다른
  // 스위트와 같은 공유 테이블을 쓰기 때문에, id 단위 정리만으로는 "테이블 전체"를
  // 단언하는 아래 totals/빈 컬렉션 테스트를 다른 워커의 커밋으로부터 지킬 수 없다.
  //
  // `users`에는 이 잠금을 넓히지 않는다. 이 스위트가 만드는 계정은 `examples-api-`
  // 접두사로 지우고, `users`를 "테이블 전체"로 단언하는 테스트는(그런 컬렉션 라우트
  // 자체가 없다) 이 파일에도 다른 어떤 스위트에도 없다 — 잠금이 막아 줄 간섭이
  // 애초에 없으므로 넓히면 병렬성만 잃는다.
  // `beforeAll`이 잠금을 잡기 전에 실패해도 아래 `afterAll`이 돌므로 `undefined`를
  // 허용한다. 캐스트로 초기화를 가장하면 그 경우 `afterAll`이 TypeError를 던지고,
  // Jest는 그것을 "Test suite failed to run"으로 보고하면서 원래의 실패 원인을 덮는다
  // (실측: 빈 DB에서 이 스위트가 먼저 출발했을 때 실제로 그렇게 가려졌다).
  let commitLock: CommitLockHandle | undefined;

  // 이 스위트가 커밋한 자원의 id. afterEach가 지우는 범위를 이 목록으로 좁힌다 —
  // 조건 없는 DELETE는 같은 순간 다른 워커(예: examples-put.spec.ts, 동일 id로
  // 실제 커밋되는 PUT 시나리오를 돈다)가 커밋해 둔 행까지 지운다. 실제로 겪었던 사고다.
  const createdExampleIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdTagIds: string[] = [];

  const api = (): ReturnType<typeof request> => request(app.getHttpServer());

  /**
   * JSON:API 헤더를 갖춘 POST.
   *
   * 만든 자원의 id를 `createdExampleIds`에 적립하므로 `async`로 감싸 응답 본문을
   * 읽는다 — 정리 범위를 이 스위트가 실제로 만든 행으로 좁히려면 그 id를 알아야 한다.
   * 실패 응답(422·403·409 등)은 `data.id`가 없으므로 아무것도 적립되지 않는다.
   */
  async function createExample(
    attributes: Record<string, unknown>,
    relationships?: unknown,
  ): Promise<Response> {
    const response = await api()
      .post('/api/v1/examples')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            attributes,
            ...(relationships === undefined ? {} : { relationships }),
          },
        }),
      );
    const id = (response.body as { data?: { id?: unknown } }).data?.id;
    if (typeof id === 'string') {
      createdExampleIds.push(id);
    }
    return response;
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
    createdCategoryIds.push(id);
    return id;
  }

  /** 라벨 두 행을 만들고 id를 돌려준다. */
  async function seedTags(): Promise<string[]> {
    const rows = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('ㄱ'), ('ㄴ') RETURNING id`,
    );
    const ids = rows.map((row) => row.id);
    createdTagIds.push(...ids);
    return ids;
  }

  /** Example을 `count`개 만든다. 기본 페이지 크기처럼 "여러 건" 단언에 쓴다. */
  async function seedExamples(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await createExample({ title: `일괄 ${String(index)}`, status: 'draft', score: 0 });
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);

    // 이 스위트 전용 계정. `users`는 `acquireCommitLock`이 지키는 테이블이 아니므로
    // 잠금을 잡기 전에 만들어도 안전하다 — 자세한 이유는 위 `commitLock` 주석 참고.
    await api()
      .post('/api/v1/auth/register')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'users',
            attributes: {
              email: 'examples-api-writer@example.com',
              password: '충분히-긴-비밀번호-1234',
            },
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
            attributes: {
              email: 'examples-api-writer@example.com',
              password: '충분히-긴-비밀번호-1234',
            },
          },
        }),
      )
      .expect(200);
    accessToken = String((login.body as TokensBody).data.attributes.accessToken);

    commitLock = await acquireCommitLock(dataSource);
  });

  afterEach(async () => {
    // TRUNCATE가 아니라 DELETE다 — 행 수준 잠금만 잡아 다른 워커를 막지 않는다.
    // 그리고 이 스위트가 적립해 둔 id만 지운다 — 위 주석 참고.
    if (createdExampleIds.length > 0) {
      await dataSource.query('DELETE FROM example_tags WHERE example_id = ANY($1)', [
        createdExampleIds,
      ]);
      await dataSource.query('DELETE FROM examples WHERE id = ANY($1)', [createdExampleIds]);
      createdExampleIds.length = 0;
    }
    if (createdCategoryIds.length > 0) {
      await dataSource.query('DELETE FROM categories WHERE id = ANY($1)', [createdCategoryIds]);
      createdCategoryIds.length = 0;
    }
    if (createdTagIds.length > 0) {
      await dataSource.query('DELETE FROM tags WHERE id = ANY($1)', [createdTagIds]);
      createdTagIds.length = 0;
    }
  });

  afterAll(async () => {
    // release()와 app.close()는 무엇이 먼저 던지든 반드시 돈다 — 여기서 건너뛰면 이
    // 스위트가 연 커넥션이 풀에 남아 다른 워커가 굶는다. withRollback이 커넥션을
    // 반드시 돌려주는 것과 같은 원칙이다. `examples-api-` 접두사만 지운다 — 조건
    // 없는 DELETE는 다른 스위트가 동시에 커밋해 둔 계정까지 지운다.
    try {
      await dataSource.query(`DELETE FROM users WHERE email LIKE 'examples-api-%'`);
    } finally {
      try {
        await commitLock?.release();
      } finally {
        await app.close();
      }
    }
  });

  describe('POST /api/v1/examples', () => {
    it.each([
      ['title', 123, 422],
      ['title', true, 422],
      ['title', ' ', 201],
      ['title', null, 422],
      ['description', 123, 422],
      ['description', false, 422],
      ['score', '42', 422],
      ['score', 42.0, 201],
      ['score', true, 422],
      ['score', null, 422],
      ['status', 0, 422],
      ['title', 'x'.repeat(201), 422],
    ])('re-audit strict attribute %s=%p returns %s', async (field, value, status) => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          data: {
            type: 'examples',
            attributes: { title: 'Audit', status: 'active', score: 42, [field]: value },
          },
        });
      expect(response.status).toBe(status);
      if (status === 201) createdExampleIds.push((response.body as ResourceBody).data.id);
      else
        expect(
          (response.body as ErrorBody).errors.map((error) => [error.code, error.source?.pointer]),
        ).toEqual([['VALIDATION_ERROR', `/data/attributes/${field}`]]);
    });

    it('collects missing PUT id and attributes before semantic checks', async () => {
      const response = await api()
        .put(`/api/v1/examples/${MISSING}`)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ data: { attributes: {} } });
      expect(response.status).toBe(422);
      expect(
        (response.body as ErrorBody).errors.map((error) => error.source?.pointer).sort(),
      ).toEqual([
        '/data/attributes/score',
        '/data/attributes/status',
        '/data/attributes/title',
        '/data/id',
        '/data/type',
      ]);
    });

    it('preserves UUID URL forms and identifier metadata with exact missing-target pointers', async () => {
      const created = (
        (await createExample({ title: 'UUID', status: 'active', score: 42 })).body as ResourceBody
      ).data.id;
      const categoryId = await seedCategory();
      for (const id of [created.replaceAll('-', ''), `{${created}}`, `urn:uuid:${created}`]) {
        const result = await api().get(`/api/v1/examples/${encodeURIComponent(id)}`);
        expect(result.status).toBe(200);
        expect((result.body as ResourceBody).data.id).toBe(created);
      }
      const linked = await api()
        .patch(`/api/v1/examples/${created}/relationships/category`)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          data: {
            type: 'exampleCategories',
            id: `urn:uuid:${categoryId}`,
            meta: { source: 'audit' },
          },
        });
      expect(linked.status).toBe(204);
      const missing = await api()
        .patch(`/api/v1/examples/${created}/relationships/category`)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ data: { type: 'exampleCategories', id: MISSING } });
      expect(missing.status).toBe(404);
      expect((missing.body as ErrorBody).errors[0]?.source?.pointer).toBe('/data/id');
    });

    it('returns included empty arrays only when include is explicitly requested', async () => {
      const created = (
        (await createExample({ title: 'Include', status: 'active', score: 42 }))
          .body as ResourceBody
      ).data.id;
      const shown = await api().get(`/api/v1/examples/${created}?include=`);
      expect(shown.status).toBe(200);
      expect((shown.body as ResourceBody).included).toEqual([]);
      const list = await api().get('/api/v1/categories?include=');
      expect(list.status).toBe(200);
      expect(list.body).toHaveProperty('included', []);
    });
    it('201과 Location, 그리고 자원 문서를 낸다', async () => {
      const response = await createExample({ title: '제목', status: 'draft', score: 40 });

      expect(response.status).toBe(201);
      expect(response.headers['content-type']).toBe(VENDOR);
      const body = response.body as ResourceBody;
      expect(response.headers.location).toBe(`/api/v1/examples/${body.data.id}`);
      expect(body.data.type).toBe('examples');
      expect(body.data.attributes.title).toBe('제목');
      expect(body.data.attributes.status).toBe('draft');
      expect(body.data.attributes.score).toBe(40);
      expect(body.data.links.self).toBe(`/api/v1/examples/${body.data.id}`);
    });

    it('검증 실패를 422로, 틀린 필드를 모두 낸다', async () => {
      const response = await createExample({ title: '', status: 'unknown', score: 0 });

      expect(response.status).toBe(422);
      const body = response.body as ErrorBody;
      expect(body.errors).toHaveLength(2);
      expect(body.errors.map((error) => error.source?.pointer).sort()).toEqual([
        '/data/attributes/status',
        '/data/attributes/title',
      ]);
    });

    it('score 범위 밖의 생성을 422로 거절한다', async () => {
      const response = await createExample({ title: '범위 밖', status: 'draft', score: 101 });

      expect(response.status).toBe(422);
    });

    // Accept-Language 왕복. 프론트엔드는 detail 을 그대로 그리고 번역 사전을
    // 두지 않는다(설계 스펙 9.2) - 협상이 빠지면 한국어 사용자가 영문 오류를 본다.
    //
    // 고치기 전에는 class-validator 의 영문 문구
    // ("title must be longer than or equal to 1 characters")가 언어와 무관하게
    // 그대로 나갔다. 문구를 상수로 박지 않고 **두 언어가 서로 다른가**와
    // **한국어에 한글이 있는가**로 잰다 - 카탈로그 문구를 다듬어도 안 죽는다.
    it('쓰기 검증 오류 문구가 Accept-Language 를 따른다', async () => {
      const errorFor = async (language: string): Promise<ErrorBody['errors'][number]> => {
        const response = await api()
          .post('/api/v1/examples')
          .set('Accept', VENDOR)
          .set('Content-Type', VENDOR)
          .set('Accept-Language', language)
          .set('Authorization', `Bearer ${accessToken}`)
          .send(
            JSON.stringify({
              data: { type: 'examples', attributes: { title: '', status: 'draft', score: 0 } },
            }),
          );
        expect(response.status).toBe(422);
        const [error] = (response.body as ErrorBody).errors;
        if (error === undefined) {
          throw new Error('오류 객체가 없다');
        }
        return error;
      };

      const ko = await errorFor('ko');
      const en = await errorFor('en');

      expect(ko.source).toEqual({ pointer: '/data/attributes/title' });
      expect(ko.detail).not.toBe(en.detail);
      expect(ko.title).not.toBe(en.title);
      expect(ko.detail).toMatch(/[가-힣]/);
      expect(en.detail).not.toMatch(/[가-힣]/);
      // class-validator 의 문구도, 사용자가 보낸 값도 응답에 실리지 않는다.
      expect(JSON.stringify(ko)).not.toContain('must be longer');
      expect(JSON.stringify(en)).not.toContain('must be longer');
    });

    it('조회 필터 오류 문구도 Accept-Language 를 따른다', async () => {
      const errorFor = async (language: string): Promise<ErrorBody['errors'][number]> => {
        const response = await api()
          .get('/api/v1/examples?filter[status][exact]=probe-lab-undeclared')
          .set('Accept', VENDOR)
          .set('Accept-Language', language);
        expect(response.status).toBe(400);
        const [error] = (response.body as ErrorBody).errors;
        if (error === undefined) {
          throw new Error('오류 객체가 없다');
        }
        return error;
      };

      const ko = await errorFor('ko');
      const en = await errorFor('en');

      expect(ko.code).toBe('INVALID_FILTER');
      expect(ko.source).toEqual({ parameter: 'filter[status][exact]' });
      expect(ko.detail).not.toBe(en.detail);
      expect(ko.detail).toMatch(/[가-힣]/);
      expect(en.detail).not.toMatch(/[가-힣]/);
      // 사용자가 보낸 값이 문구에 되비치지 않는다.
      expect(JSON.stringify(ko)).not.toContain('probe-lab-undeclared');
      expect(JSON.stringify(en)).not.toContain('probe-lab-undeclared');
    });

    it('타입이 다르면 409 TYPE_MISMATCH다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(
          JSON.stringify({
            data: { type: 'others', attributes: { title: '제목', status: 'active', score: 42 } },
          }),
        );

      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('TYPE_MISMATCH');
    });

    it('클라이언트가 만든 id를 403으로 거부한다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(
          JSON.stringify({
            data: {
              type: 'examples',
              id: MISSING,
              attributes: { title: '제목', status: 'active', score: 42 },
            },
          }),
        );

      expect(response.status).toBe(403);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('CLIENT_GENERATED_ID_UNSUPPORTED');
    });

    it('to-one 관계를 함께 만든다', async () => {
      const categoryId = await seedCategory();

      const response = await createExample(
        { title: '제목', status: 'draft', score: 0 },
        { category: { data: { type: 'exampleCategories', id: categoryId } } },
      );

      expect(response.status).toBe(201);
      expect((response.body as ResourceBody).data.relationships.category?.data).toEqual({
        type: 'exampleCategories',
        id: categoryId,
      });
    });

    it('to-many 관계를 함께 만든다', async () => {
      // to-one과 다른 코드 경로다 — 해석 결과가 배열로 엔티티에 실리고 조인 테이블에
      // 행이 생긴다. to-one만 확인하면 그 경로가 통째로 비어 있게 된다.
      const tags = await seedTags();

      const response = await createExample(
        { title: '제목', status: 'draft', score: 0 },
        { tags: { data: tags.map((tagId) => ({ type: 'exampleTags', id: tagId })) } },
      );

      expect(response.status).toBe(201);
      const linkage = (response.body as ResourceBody).data.relationships.tags?.data;
      expect(linkage).toHaveLength(2);

      const rows = await dataSource.query<{ count: string }[]>('SELECT COUNT(*) FROM example_tags');
      expect(rows[0]?.count).toBe('2');
    });

    it('없는 관계 대상은 404 RELATIONSHIP_RESOURCE_NOT_FOUND다', async () => {
      const response = await createExample(
        { title: '제목', status: 'draft', score: 0 },
        { category: { data: { type: 'exampleCategories', id: MISSING } } },
      );

      expect(response.status).toBe(404);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
    });

    it('관계 대상을 못 찾으면 자원도 만들지 않는다', async () => {
      // 트랜잭션이 실제로 걸려 있는지 확인한다. 자원만 남고 관계가 비면
      // 클라이언트가 만든 적 없는 자원이 생긴다.
      await createExample(
        { title: '제목', status: 'draft', score: 0 },
        { category: { data: { type: 'exampleCategories', id: MISSING } } },
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
      await createExample({ title: 'ㄱ', status: 'draft', score: 0 });
      await createExample({ title: 'ㄴ', status: 'draft', score: 0 });

      const response = await api().get('/api/v1/examples?page[size]=1').set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.data).toHaveLength(1);
      expect(body.links.next).toContain('page%5Bnumber%5D=2');
      expect(body.meta).toBeUndefined();
    });

    it('totals를 요청하면 총 개수와 last 링크를 낸다', async () => {
      await createExample({ title: 'ㄱ', status: 'draft', score: 0 });
      await createExample({ title: 'ㄴ', status: 'draft', score: 0 });

      const response = await api()
        .get('/api/v1/examples?page[size]=1&page[totals]=true')
        .set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.meta?.totalCount).toBe(2);
      expect(body.links.last).toContain('page%5Bnumber%5D=2');
    });

    it('filter와 sort를 적용한다', async () => {
      await createExample({ title: 'ㄱ', status: 'active', score: 0 });
      await createExample({ title: 'ㄴ', status: 'draft', score: 0 });

      const response = await api()
        .get('/api/v1/examples?filter[status]=active&sort=title')
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

    it('제거된 publishedAt filter를 INVALID_FILTER로 거절한다', async () => {
      const response = await api()
        .get('/api/v1/examples?filter[publishedAt][gte]=2026-01-01T00:00:00Z')
        .set('Accept', VENDOR);

      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_FILTER');
    });

    it('구 공개 필터 이름 filter[category]를 INVALID_FILTER로 거절한다', async () => {
      // 필터 이름이 category.id로 바뀌었다. 코드 경로는 같아 실질 위험은 없지만,
      // 마이그레이션하는 클라이언트가 가장 먼저 부딪히는 이름이라 와이어에서 고정한다.
      const response = await api()
        .get(`/api/v1/examples?filter[category]=${MISSING}`)
        .set('Accept', VENDOR);

      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_FILTER');
    });

    it('제거된 publishedAt sort를 INVALID_SORT로 거절한다', async () => {
      const response = await api().get('/api/v1/examples?sort=publishedAt').set('Accept', VENDOR);

      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_SORT');
    });

    it('id를 공개 정렬로 받지 않는다', async () => {
      // tie breaker 전용이다. 정본의 공개 정렬에 id가 없다.
      const response = await api().get('/api/v1/examples?sort=id').set('Accept', VENDOR);

      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_SORT');
    });

    it('정책이 여는 모든 필터·연산자 쌍과 모든 정렬이 전부 2xx다', async () => {
      // 정책이 선언한 (필드, 연산자) 쌍을 하나도 빠짐없이 덮는다 — 하나라도 빠지면
      // 그 쌍이 존재하지 않는 컬럼을 가리키게 되어도(이번 태스크가 고친 publishedAt
      // 버그처럼) 이 테스트가 못 잡는다.
      const queries = [
        // title: exact, contains
        'filter[title]=x',
        'filter[title][contains]=x',
        // status: exact, in
        'filter[status]=draft',
        'filter[status][in]=draft,active',
        // score: exact, gt, gte, lt, lte, in
        'filter[score]=10',
        'filter[score][gt]=0',
        'filter[score][gte]=0',
        'filter[score][lt]=100',
        'filter[score][lte]=100',
        'filter[score][in]=10,20',
        // category.id: exact, in, isNull
        `filter[category.id]=${MISSING}`,
        `filter[category.id][in]=${MISSING},${MISSING}`,
        'filter[category.id][isNull]=true',
        // createdAt: exact, gt, gte, lt, lte
        'filter[createdAt]=2026-01-01T00:00:00Z',
        'filter[createdAt][gt]=2026-01-01T00:00:00Z',
        'filter[createdAt][gte]=2026-01-01T00:00:00Z',
        'filter[createdAt][lt]=2026-01-01T00:00:00Z',
        'filter[createdAt][lte]=2026-01-01T00:00:00Z',
        // sorts: title, status, score, createdAt, updatedAt
        'sort=title',
        'sort=status',
        'sort=score',
        'sort=createdAt',
        'sort=updatedAt',
        'sort=-score,title',
      ];

      for (const query of queries) {
        const response = await api().get(`/api/v1/examples?${query}`).set('Accept', VENDOR);

        expect([query, response.status]).toEqual([query, 200]);
      }
    });

    it('page[size] 없는 목록이 20건을 낸다', async () => {
      // 21건 이상을 만들어 기본값이 실제로 자르는지 본다. 20건 이하면 정책이
      // 25든 20이든 같은 결과가 나와 테스트가 아무것도 고정하지 못한다.
      await seedExamples(21);

      const response = await api().get('/api/v1/examples').set('Accept', VENDOR);

      expect(response.status).toBe(200);
      expect((response.body as CollectionBody).data).toHaveLength(20);
    });
  });

  describe('GET /api/v1/examples/{id}', () => {
    it('자원 하나를 낸다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;

      const response = await api().get(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as ResourceBody).data.id).toBe(id);
    });

    it('include로 관계 자원을 함께 낸다', async () => {
      const categoryId = await seedCategory();
      const created = await createExample(
        { title: '제목', status: 'draft', score: 0 },
        { category: { data: { type: 'exampleCategories', id: categoryId } } },
      );
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}?include=category`)
        .set('Accept', VENDOR);
      expect(response.body as ResourceBody).toHaveProperty('included');
      expect((response.body as ResourceBody).included?.[0]?.type).toBe('exampleCategories');
    });

    it('include된 참조 자원이 self 링크를 낸다', async () => {
      // Task 6이 CATEGORY_SERIALIZER·TAG_SERIALIZER에 resourcePath를 주면서 included[]에
      // links.self가 붙었다 — 관측 가능한 계약 변경이다. 링크 문자열을 만드는 함수 자체는
      // test/serializers/example.serializer.spec.ts가 고정하고, 여기서 보는 것은 그 결과가
      // collectIncluded와 문서 조립을 지나 응답까지 그대로 실려 나가는가다.
      const categoryId = await seedCategory();
      const tagIds = await seedTags();
      const created = await createExample(
        { title: '제목', status: 'draft', score: 0 },
        {
          category: { data: { type: 'exampleCategories', id: categoryId } },
          tags: { data: tagIds.map((tagId) => ({ type: 'exampleTags', id: tagId })) },
        },
      );
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}?include=category,tags`)
        .set('Accept', VENDOR);

      expect(response.status).toBe(200);
      const included = (response.body as ResourceBody).included ?? [];

      // JSON:API type은 exampleCategories·exampleTags이고 링크는 URL 경로
      // (/api/v1/categories·/api/v1/tags)를 쓴다. 둘이 다른 것이 이 브랜치의 결정이므로
      // 그 차이를 여기서 함께 고정한다.
      expect(included.find((item) => item.type === 'exampleCategories')?.links?.self).toBe(
        `/api/v1/categories/${categoryId}`,
      );
      expect(
        included
          .filter((item) => item.type === 'exampleTags')
          .map((item) => item.links?.self)
          .sort(),
      ).toEqual(tagIds.map((tagId) => `/api/v1/tags/${tagId}`).sort());
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
      const created = await createExample({
        title: '제목',
        description: '본문',
        status: 'draft',
        score: 0,
      });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: { type: 'examples', id, attributes: { title: '새 제목' } } }));

      expect(response.status).toBe(200);
      const body = response.body as ResourceBody;
      expect(body.data.attributes.title).toBe('새 제목');
      // 보내지 않은 필드는 그대로여야 한다. 이것이 스펙 7.1의 계약이다.
      expect(body.data.attributes.description).toBe('본문');
    });

    it('null로 보낸 필드는 비운다', async () => {
      const created = await createExample({
        title: '제목',
        description: '본문',
        status: 'draft',
        score: 0,
      });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(
          JSON.stringify({ data: { type: 'examples', id, attributes: { description: null } } }),
        );

      expect((response.body as ResourceBody).data.attributes.description).toBeNull();
    });

    it('NOT NULL 컬럼을 null로 보내면 500이 아니라 422다', async () => {
      // `null`을 비우기로 읽는 것은 nullable 컬럼에서만 성립한다. title은 NOT NULL이라
      // 검증을 통과시키면 PostgreSQL이 거절해 사용자 입력 오류가 500으로 나간다.
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: { type: 'examples', id, attributes: { title: null } } }));

      expect(response.status).toBe(422);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('VALIDATION_ERROR');
      expect((response.body as ErrorBody).errors[0]?.source?.pointer).toBe(
        '/data/attributes/title',
      );
    });

    it('경로와 문서의 id가 다르면 409 ID_MISMATCH다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: { type: 'examples', id: MISSING, attributes: {} } }));

      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('ID_MISMATCH');
    });
  });

  describe('DELETE /api/v1/examples/{id}', () => {
    it('204를 내고 실제로 지운다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .delete(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(204);
      // 204는 본문이 없다. 라우트 등록기가 붙인 상태 코드가 실제로 나가는지 함께 본다.
      expect(response.text).toBe('');

      const after = await api().get(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(after.status).toBe(404);
    });
  });

  describe('관계 라우트', () => {
    it('to-many linkage를 읽는다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as { data: unknown[] }).data).toEqual([]);
    });

    it('to-many linkage를 교체하고 204를 낸다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();

      const response = await api()
        .patch(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: tags.map((tagId) => ({ type: 'exampleTags', id: tagId })) }));

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('to-many에 더하고 뺀다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
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
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: [{ type: 'exampleTags', id: first }] }));
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
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: [{ type: 'exampleTags', id: first }] }));
      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');

      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown[] }).data).toEqual([]);
    });

    it('to-one linkage를 교체하고 해제한다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;
      const categoryId = await seedCategory();

      const replaced = await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: { type: 'exampleCategories', id: categoryId } }));
      expect(replaced.status).toBe(204);
      expect(replaced.text).toBe('');

      const between = await api()
        .get(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR);
      expect((between.body as { data: unknown }).data).toEqual({
        type: 'exampleCategories',
        id: categoryId,
      });

      const cleared = await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: null }));
      expect(cleared.status).toBe(204);
      expect(cleared.text).toBe('');

      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown }).data).toBeNull();
    });

    it('related 자원 경로가 연결된 자원을 낸다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();
      await api()
        .patch(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: tags.map((tagId) => ({ type: 'exampleTags', id: tagId })) }))
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
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;
      const categoryId = await seedCategory();
      await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(JSON.stringify({ data: { type: 'exampleCategories', id: categoryId } }))
        .expect(204);

      const response = await api().get(`/api/v1/examples/${id}/category`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      const body = response.body as { data: { type: string; id: string } };
      expect(body.data.type).toBe('exampleCategories');
      expect(body.data.id).toBe(categoryId);
    });

    it('연결이 없으면 to-one related 경로가 null을 낸다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;

      const response = await api().get(`/api/v1/examples/${id}/category`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as { data: unknown }).data).toBeNull();
    });

    it('to-one related 경로는 조회 파라미터를 거부한다', async () => {
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
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

    it('본문을 싣는 DELETE의 Content-Type도 검사한다', async () => {
      // 관계 라우트의 DELETE는 linkage 본문을 싣는다. 협상을 메서드로만 판정하면
      // 이 경로만 검사에서 새어 나가 잘못된 미디어 타입이 성공(204)한다.
      const created = await createExample({ title: '제목', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();

      const response = await api()
        .delete(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ data: tags.map((tagId) => ({ type: 'exampleTags', id: tagId })) }));

      expect(response.status).toBe(415);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('본문 없는 GET은 Content-Type이 달라도 통과한다', async () => {
      // 스펙 5.1이 415를 요구하는 대상은 "본문이 있는 요청"이다. 본문을 싣지 않은
      // 요청에 붙은 Content-Type은 아무것도 서술하지 않으므로 협상 대상이 아니다.
      const response = await api()
        .get('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
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

  describe('쓰기 보호', () => {
    it('토큰 없이 쓰면 401이다', async () => {
      // 스펙 16장: 읽기는 공개, 쓰기는 활성 사용자의 Bearer access token을 요구한다.
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'examples', attributes: { title: '보호' } } }))
        .expect(401);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('토큰 없이 읽는 것은 그대로 된다', async () => {
      // 쓰기를 막으면서 읽기까지 막아 버리는 것이 이 변경의 가장 쉬운 실패다.
      await api().get('/api/v1/examples').set('Accept', VENDOR).expect(200);
    });

    it('토큰 없이 관계를 바꾸면 401이다', async () => {
      // 관계 쓰기 라우트도 `writeMethods`에 들어 있으므로 같은 가드가 붙어야 한다.
      // 이 스위트는 고정 id를 쓰지 않으므로 대상은 이 테스트가 직접 만든다.
      const created = await createExample({ title: '관계 보호', status: 'draft', score: 0 });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: null }))
        .expect(401);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('Content-Type이 틀리면 인증보다 협상이 먼저 걸린다', async () => {
      // 협상 가드는 컨트롤러 단위, 인증 가드는 라우트 단위라 Nest가 협상을 먼저 돌린다.
      // 이 순서가 뒤집히면 잘못된 요청의 오류 코드가 조용히 바뀐다.
      await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ data: { type: 'examples', attributes: { title: '협상' } } }))
        .expect(415);
    });
  });
});
