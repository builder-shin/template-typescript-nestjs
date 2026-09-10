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

/** `examples-api.spec.ts`와 같은 모양. 상태 코드는 여러 원인이 공유하지만 이 코드는 원인을 특정한다. */
interface ErrorBody {
  errors: { code: string; status: string; title: string; source?: { pointer?: string } }[];
}

/** 로그인 응답. access token만 꺼내 쓴다. */
interface TokensBody {
  data: { attributes: Record<string, unknown> };
}

describe('PUT /api/v1/examples/{id}', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  // 이 스위트가 쓰기(PUT)에 쓰는 access token. 읽기 요청에는 붙이지 않는다.
  let accessToken: string;
  // examples-api.spec.ts와의 상호 배제 손잡이. 이 스위트는 고정 id(`ID`/`OTHER`)와
  // `put-` 접두사만 써서 그 스위트의 행과 절대 안 겹치지만, 그 스위트의 "테이블 전체"
  // 단언(빈 컬렉션·총 개수)은 id가 다르든 말든 이 스위트가 잠깐 커밋해 둔 행까지 센다.
  // 자세한 이유는 fixture.ts의 `acquireCommitLock` 문서 주석 참고.
  //
  // `users`에는 이 잠금을 넓히지 않는다 — 이유는 examples-api.spec.ts의 같은 주석과
  // 같다. 이 스위트가 만드는 계정은 `examples-put-` 접두사로만 지운다.
  // `beforeAll`이 잠금을 잡기 전에 실패해도 아래 `afterAll`이 돌므로 `undefined`를
  // 허용한다. 캐스트로 초기화를 가장하면 그 경우 `afterAll`이 TypeError를 던지고,
  // Jest는 그것을 "Test suite failed to run"으로 보고하면서 원래의 실패 원인을 덮는다
  // (examples-api.spec.ts의 같은 주석 참고 — 그쪽에서 실제로 관측된 가림이다).
  let commitLock: CommitLockHandle | undefined;

  const api = (): ReturnType<typeof request> => request(app.getHttpServer());

  function put(id: string, attributes: Record<string, unknown>, relationships?: unknown): Test {
    return api()
      .put(`/api/v1/examples/${id}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .set('Authorization', `Bearer ${accessToken}`)
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
              email: 'examples-put-writer@example.test',
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
              email: 'examples-put-writer@example.test',
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
    // 이 스위트가 쓰는 id만 지운다. 조건 없는 삭제는 같은 순간 다른 워커가 커밋해 둔
    // 행까지 지운다.
    await dataSource.query('DELETE FROM example_tags WHERE example_id = ANY($1)', [[ID, OTHER]]);
    await dataSource.query('DELETE FROM examples WHERE id = ANY($1)', [[ID, OTHER]]);
    await dataSource.query(`DELETE FROM tags WHERE name LIKE 'put-%'`);
    await dataSource.query(`DELETE FROM categories WHERE name LIKE 'put-%'`);
  });

  afterAll(async () => {
    // release()와 app.close()는 무엇이 먼저 던지든 반드시 돈다 — 여기서 건너뛰면 이
    // 스위트가 연 커넥션이 풀에 남아 다른 워커가 굶는다. withRollback이 커넥션을
    // 반드시 돌려주는 것과 같은 원칙이다. `examples-put-` 접두사만 지운다 — 조건
    // 없는 DELETE는 다른 스위트가 동시에 커밋해 둔 계정까지 지운다.
    try {
      await dataSource.query(`DELETE FROM users WHERE email LIKE 'examples-put-%'`);
    } finally {
      try {
        await commitLock?.release();
      } finally {
        await app.close();
      }
    }
  });

  it('없는 id면 201과 Location을 낸다', async () => {
    const response = await put(ID, { title: '만들어진 것', status: 'draft', score: 0 });

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/examples/${ID}`);
    expect(response.headers['content-type']).toBe(VENDOR);
    const body = response.body as ResourceBody;
    expect(body.data.id).toBe(ID);
    expect(body.data.attributes.title).toBe('만들어진 것');
    expect(body.data.attributes.status).toBe('draft');
  });

  it('있는 id면 200으로 교체한다', async () => {
    await put(ID, { title: '처음', status: 'draft', score: 0 }).expect(201);
    const response = await put(ID, { title: '두 번째', status: 'draft', score: 0 });

    expect(response.status).toBe(200);
    // 교체는 생성이 아니므로 Location을 내지 않는다.
    expect(response.headers.location).toBeUndefined();
    expect((response.body as ResourceBody).data.attributes.title).toBe('두 번째');
  });

  it('행이 하나만 남는다', async () => {
    await put(ID, { title: '처음', status: 'draft', score: 0 }).expect(201);
    await put(ID, { title: '두 번째', status: 'draft', score: 0 }).expect(200);
    const rows = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
      [ID],
    );
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('보내지 않은 attribute를 기본값으로 되돌린다', async () => {
    // 이것이 PATCH와 갈리는 지점이다. PATCH였다면 description이 남는다. status·score는
    // 이제 생성과 마찬가지로 필수라 두 번째 요청에서도 함께 보낸다 — 생략하면 기본값
    // 되돌림이 아니라 422다. status의 DB 기본값('draft')은 여전히 존재하지만
    // 스키마가 필수로 만든 뒤로는 API 요청으로 그 경로에 닿을 수 없다(그 경로는
    // test/integration/upsert-executor.spec.ts가 단위 수준에서 계속 지킨다). 여기서
    // 확인할 수 있는 "기본값 되돌림"은 nullable인 description뿐이다.
    await put(ID, { title: '처음', description: '본문', status: 'active', score: 90 }).expect(201);
    const response = await put(ID, { title: '두 번째', status: 'draft', score: 0 });

    const attributes = (response.body as ResourceBody).data.attributes;
    expect(attributes.description).toBeNull();
  });

  it('보내지 않은 관계를 비운다', async () => {
    const tags = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('put-ㄱ'), ('put-ㄴ') RETURNING id`,
    );
    const linkage = tags.map((tag) => ({ type: 'exampleTags', id: tag.id }));

    await put(ID, { title: '처음', status: 'draft', score: 0 }, { tags: { data: linkage } }).expect(
      201,
    );
    const before = await api()
      .get(`/api/v1/examples/${ID}/relationships/tags`)
      .set('Accept', VENDOR);
    expect((before.body as { data: unknown[] }).data).toHaveLength(2);

    await put(ID, { title: '두 번째', status: 'draft', score: 0 }).expect(200);
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
      { title: '처음', status: 'draft', score: 0 },
      { category: { data: { type: 'exampleCategories', id: categoryId } } },
    ).expect(201);
    const before = await api()
      .get(`/api/v1/examples/${ID}/relationships/category`)
      .set('Accept', VENDOR);
    expect((before.body as LinkageBody).data).toEqual({
      type: 'exampleCategories',
      id: categoryId,
    });

    // PUT 응답 본문으로는 이 reset을 확인할 수 없다. replace()의 재조회는 요청이 보낸
    // 관계만 include하므로(`Object.keys(parsed.relationships)`), category를 아예 보내지
    // 않은 이 두 번째 요청은 category를 로드하지 않고, serializeResource는 로드되지 않은
    // 관계의 data 키를 통째로 생략한다 — 값이 null이 아니라 undefined다. 그래서 실제
    // 저장 상태는 관계 엔드포인트로 직접 물어서 확인한다.
    await put(ID, { title: '두 번째', status: 'draft', score: 0 }).expect(200);
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
      .set('Authorization', `Bearer ${accessToken}`)
      .send(
        JSON.stringify({ data: { type: 'examples', id: OTHER, attributes: { title: '제목' } } }),
      );
    expect(response.status).toBe(409);
    // 상태 코드만으로는 TYPE_MISMATCH 같은 다른 409 원인과 갈리지 않는다.
    expect((response.body as ErrorBody).errors[0]?.code).toBe('ID_MISMATCH');
  });

  it('교체 스키마의 필수 필드가 없으면 422다', async () => {
    // PUT은 전체 교체라 생성과 같은 필수 조건을 건다.
    const response = await put(ID, {});
    expect(response.status).toBe(422);
  });

  it('없는 관계 대상을 가리키면 자원도 남지 않는다', async () => {
    const missing = '0195c1a0-0000-7000-8000-0000000009ff';
    const response = await put(
      ID,
      { title: '제목', status: 'draft', score: 0 },
      { category: { data: { type: 'exampleCategories', id: missing } } },
    ).expect(404);
    // 상태 코드만으로는 RESOURCE_NOT_FOUND(자원 자체가 없음) 같은 다른 404 원인과
    // 갈리지 않는다 — 이 404는 관계 대상을 못 찾은 것이어야 한다.
    expect((response.body as ErrorBody).errors[0]?.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');

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
    // 돌려도 전부 통과했다. 잠금이 트랜잭션 스코프라는 것(잡혀 있다가 트랜잭션이 끝나면
    // 풀린다)은 test/integration/upsert-executor.spec.ts가 pg_locks로 직접 검증한다 —
    // 다만 "삽입 문장보다 먼저 잠근다"는 순서는 그 pg_locks 단언이 아니라 upsertRow의
    // 소스를 읽어서 아는 사실이다(잠금 쿼리가 insert 호출보다 앞에 있다).
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
      put(
        ID,
        { title: '가', status: 'draft', score: 0 },
        { tags: { data: [{ type: 'exampleTags', id: tagId }] } },
      ),
      put(ID, { title: '나', status: 'draft', score: 0 }, { tags: { data: [] } }),
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
