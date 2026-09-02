import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Test } from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';
import { acquireCommitLock } from '../db/fixture.js';
import type { CommitLockHandle } from '../db/fixture.js';

const VENDOR = 'application/vnd.api+json';
const ID = '0195c1a0-0000-7000-8000-00000000d001';
const OTHER = '0195c1a0-0000-7000-8000-00000000d002';

interface ResourceBody {
  data: {
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data?: unknown }>;
  };
}

/** 관계 엔드포인트(`GET .../relationships/<name>`)가 돌려주는 to-one linkage 문서. */
interface LinkageBody {
  data: { type: string; id: string } | null;
}

describe('PUT /api/v1/examples/{id}', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  // examples-api.spec.ts와의 상호 배제 손잡이. 이 스위트는 고정 id(`ID`/`OTHER`)와
  // `put-` 접두사만 써서 그 스위트의 행과 절대 안 겹치지만, 그 스위트의 "테이블 전체"
  // 단언(빈 컬렉션·총 개수)은 id가 다르든 말든 이 스위트가 잠깐 커밋해 둔 행까지 센다.
  // 자세한 이유는 fixture.ts의 `acquireCommitLock` 문서 주석 참고.
  let commitLock: CommitLockHandle;

  const api = (): ReturnType<typeof request> => request(app.getHttpServer());

  function put(id: string, attributes: Record<string, unknown>, relationships?: unknown): Test {
    return api()
      .put(`/api/v1/examples/${id}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            id,
            attributes,
            ...(relationships === undefined ? {} : { relationships }),
          },
        }),
      );
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    commitLock = await acquireCommitLock(dataSource);
  });

  afterEach(async () => {
    // 이 스위트가 쓰는 id만 지운다. 조건 없는 삭제는 같은 순간 다른 워커가 커밋해 둔
    // 행까지 지운다.
    await dataSource.query('DELETE FROM example_tags WHERE example_id = ANY($1)', [[ID, OTHER]]);
    await dataSource.query('DELETE FROM examples WHERE id = ANY($1)', [[ID, OTHER]]);
    await dataSource.query(`DELETE FROM tags WHERE name LIKE 'put-%'`);
    await dataSource.query(`DELETE FROM categories WHERE name LIKE 'put-%'`);
  });

  afterAll(async () => {
    await commitLock.release();
    await app.close();
  });

  it('없는 id면 201과 Location을 낸다', async () => {
    const response = await put(ID, { title: '만들어진 것' });

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/examples/${ID}`);
    expect(response.headers['content-type']).toBe(VENDOR);
    const body = response.body as ResourceBody;
    expect(body.data.id).toBe(ID);
    expect(body.data.attributes.title).toBe('만들어진 것');
    // 보내지 않은 필드는 컬럼 기본값으로 들어간다.
    expect(body.data.attributes.status).toBe('draft');
  });

  it('있는 id면 200으로 교체한다', async () => {
    await put(ID, { title: '처음' }).expect(201);
    const response = await put(ID, { title: '두 번째' });

    expect(response.status).toBe(200);
    // 교체는 생성이 아니므로 Location을 내지 않는다.
    expect(response.headers.location).toBeUndefined();
    expect((response.body as ResourceBody).data.attributes.title).toBe('두 번째');
  });

  it('행이 하나만 남는다', async () => {
    await put(ID, { title: '처음' }).expect(201);
    await put(ID, { title: '두 번째' }).expect(200);
    const rows = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
      [ID],
    );
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('보내지 않은 attribute를 기본값으로 되돌린다', async () => {
    // 이것이 PATCH와 갈리는 지점이다. PATCH였다면 body가 남는다.
    await put(ID, { title: '처음', body: '본문', status: 'published' }).expect(201);
    const response = await put(ID, { title: '두 번째' });

    const attributes = (response.body as ResourceBody).data.attributes;
    expect(attributes.body).toBeNull();
    expect(attributes.status).toBe('draft');
  });

  it('보내지 않은 관계를 비운다', async () => {
    const tags = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('put-ㄱ'), ('put-ㄴ') RETURNING id`,
    );
    const linkage = tags.map((tag) => ({ type: 'tags', id: tag.id }));

    await put(ID, { title: '처음' }, { tags: { data: linkage } }).expect(201);
    const before = await api()
      .get(`/api/v1/examples/${ID}/relationships/tags`)
      .set('Accept', VENDOR);
    expect((before.body as { data: unknown[] }).data).toHaveLength(2);

    await put(ID, { title: '두 번째' }).expect(200);
    const after = await api()
      .get(`/api/v1/examples/${ID}/relationships/tags`)
      .set('Accept', VENDOR);
    expect((after.body as { data: unknown[] }).data).toEqual([]);
  });

  it('to-one 관계도 비운다', async () => {
    const categories = await dataSource.query<{ id: string }[]>(
      `INSERT INTO categories (name) VALUES ('put-분류') RETURNING id`,
    );
    const categoryId = categories[0]?.id;
    if (categoryId === undefined) {
      throw new Error('분류를 만들지 못했다');
    }

    await put(
      ID,
      { title: '처음' },
      { category: { data: { type: 'categories', id: categoryId } } },
    ).expect(201);
    const before = await api()
      .get(`/api/v1/examples/${ID}/relationships/category`)
      .set('Accept', VENDOR);
    expect((before.body as LinkageBody).data).toEqual({ type: 'categories', id: categoryId });

    // PUT 응답 본문으로는 이 reset을 확인할 수 없다. replace()의 재조회는 요청이 보낸
    // 관계만 include하므로(`Object.keys(parsed.relationships)`), category를 아예 보내지
    // 않은 이 두 번째 요청은 category를 로드하지 않고, serializeResource는 로드되지 않은
    // 관계의 data 키를 통째로 생략한다 — 값이 null이 아니라 undefined다. 그래서 실제
    // 저장 상태는 관계 엔드포인트로 직접 물어서 확인한다.
    await put(ID, { title: '두 번째' }).expect(200);
    const after = await api()
      .get(`/api/v1/examples/${ID}/relationships/category`)
      .set('Accept', VENDOR);
    expect((after.body as LinkageBody).data).toBeNull();
  });

  it('경로와 문서의 id가 다르면 409다', async () => {
    const response = await api()
      .put(`/api/v1/examples/${ID}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({ data: { type: 'examples', id: OTHER, attributes: { title: '제목' } } }),
      );
    expect(response.status).toBe(409);
  });

  it('교체 스키마의 필수 필드가 없으면 422다', async () => {
    // PUT은 전체 교체라 생성과 같은 필수 조건을 건다.
    const response = await put(ID, {});
    expect(response.status).toBe(422);
  });

  it('없는 관계 대상을 가리키면 자원도 남지 않는다', async () => {
    const missing = '0195c1a0-0000-7000-8000-0000000009ff';
    await put(
      ID,
      { title: '제목' },
      { category: { data: { type: 'categories', id: missing } } },
    ).expect(404);

    const rows = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
      [ID],
    );
    // upsert 문장이 이미 행을 만든 뒤에 관계 해석이 실패한다. 트랜잭션이 그것을
    // 되돌리지 않으면 클라이언트가 만든 적 없는 자원이 남는다.
    expect(rows).toEqual([{ count: 0 }]);
  });

  it('같은 id로 동시에 들어온 두 요청이 섞이지 않는다', async () => {
    // 이 테스트가 잡는 것은 같은 id 동시 요청에서 섞인 상태가 나오지 않는다는 것이고,
    // 지금 그것을 보장하는 것은 upsertRow의 `ON CONFLICT` 문장이 잡는 PostgreSQL의 행
    // 잠금이다 — 그 문장이 트랜잭션의 첫 DB 접근이라 나머지 전부(관계 해석·저장)가 그
    // 잠금 안에서 일어난다. advisory 잠금은 이 보장을 대체하는 게 아니라, 언젠가
    // upsert *앞에* DB 접근이 생겨도(훅, 사전 확인 등) 계속 성립하게 만드는 보강이다 —
    // 그래서 이 테스트를 통과시키는 힘은 지금 advisory 잠금에서 나오지 않는다. 실측:
    // upsertRow의 advisory 잠금 줄을 비활성화한 채 이 테스트를 2-way 8회·4-way 15회
    // 돌려도 전부 통과했다. 잠금 자체의 계약(삽입 전에 걸린다, 트랜잭션 스코프다)은
    // test/integration/upsert-executor.spec.ts가 pg_locks로 직접 검증한다.
    //
    // 두 요청은 attribute와 관계를 모두 다르게 보낸다. 직렬화되지 않으면 한쪽의 제목과
    // 다른 쪽의 관계가 섞인 상태가 남을 수 있다 — 두 요청 중 어느 것도 보낸 적 없는 상태다.
    const tags = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('put-동시') RETURNING id`,
    );
    const tagId = tags[0]?.id;
    if (tagId === undefined) {
      throw new Error('라벨을 만들지 못했다');
    }

    const [first, second] = await Promise.all([
      put(ID, { title: '가' }, { tags: { data: [{ type: 'tags', id: tagId }] } }),
      put(ID, { title: '나' }, { tags: { data: [] } }),
    ]);

    // 둘 다 성공하고, 정확히 하나만 생성이다.
    expect([first.status, second.status].sort()).toEqual([200, 201]);

    const rows = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
      [ID],
    );
    expect(rows).toEqual([{ count: 1 }]);

    const final = await api().get(`/api/v1/examples/${ID}?include=tags`).set('Accept', VENDOR);
    const attributes = (final.body as ResourceBody).data.attributes;
    const linkage = (final.body as ResourceBody).data.relationships.tags?.data;

    // 최종 상태는 두 요청 중 **하나와 통째로** 같아야 한다. 어느 쪽이 이기는지는
    // 정하지 않는다 — 직렬화가 보장하는 것은 승자가 있다는 것이지 누구인지가 아니다.
    const wonByFirst = attributes.title === '가' && Array.isArray(linkage) && linkage.length === 1;
    const wonBySecond = attributes.title === '나' && Array.isArray(linkage) && linkage.length === 0;
    expect(wonByFirst || wonBySecond).toBe(true);
  });
});
