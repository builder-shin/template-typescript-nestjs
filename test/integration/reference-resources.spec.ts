import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';
import { acquireCommitLock } from '../db/fixture.js';
import type { CommitLockHandle } from '../db/fixture.js';

const JSONAPI = 'application/vnd.api+json';

interface CollectionBody {
  readonly data: readonly {
    readonly type: string;
    readonly id: string;
    readonly attributes: { readonly name: string };
  }[];
  readonly links: Readonly<Record<string, string | null>>;
}

interface SingleBody {
  readonly data: {
    readonly links?: Readonly<Record<string, string>>;
    readonly attributes: Readonly<Record<string, unknown>>;
  };
}

interface ErrorBody {
  readonly errors: readonly { readonly code: string }[];
}

describe('참조 자원 읽기 라우트', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  // examples-api.spec.ts와의 상호 배제 손잡이. `categories`·`tags`는 그 스위트와
  // examples-put.spec.ts도 실제로 커밋하는 공유 테이블이고, 아래 테스트 상당수가
  // 필터 없이 "테이블 전체"를 읽는다(목록 정렬, 커서 완주, 정렬 뒤집기). 그 사이에
  // 다른 워커가 이 테이블에 행을 커밋하거나 지우면 그 읽기들이 조용히 깨진다 —
  // 자세한 이유는 `test/db/fixture.ts`의 `acquireCommitLock` 문서 주석 참고.
  let commitLock: CommitLockHandle | undefined;

  const categoryIds: string[] = [];
  const tagIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);

    commitLock = await acquireCommitLock(dataSource);

    // 분류 세 개, 라벨 두 개. 이름은 ASCII로 둔다 — 정렬 기대값이 PostgreSQL의
    // 대조 규칙에 의존하지 않게 하려는 것이다. 한글 이름을 쓰면 DB locale에 따라
    // 순서가 JS의 기본 비교와 갈릴 수 있다. 분류가 3개인 것은 의도적이다 — 커서
    // 순회(`page[size]=1`)와 정렬 뒤집기 테스트가 실제로 무언가를 확인하려면
    // 페이지가 최소 둘 이상 나와야 한다.
    const categories = await dataSource.query<{ id: string }[]>(
      `INSERT INTO categories (name) VALUES ('alpha'), ('beta'), ('gamma') RETURNING id`,
    );
    categoryIds.push(...categories.map((row) => row.id));

    const tags = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('draft-only'), ('public') RETURNING id`,
    );
    tagIds.push(...tags.map((row) => row.id));
  });

  afterAll(async () => {
    // 정리는 잠금을 쥔 채로 한다 — 이 스위트가 커밋한 행이므로, 다른 워커가
    // 잠금을 얻기 전에 이 스위트가 스스로 지운다.
    try {
      if (categoryIds.length > 0) {
        await dataSource.query('DELETE FROM categories WHERE id = ANY($1)', [categoryIds]);
      }
      if (tagIds.length > 0) {
        await dataSource.query('DELETE FROM tags WHERE id = ANY($1)', [tagIds]);
      }
    } finally {
      try {
        await commitLock?.release();
      } finally {
        await app.close();
      }
    }
  });

  it('분류 목록이 name 오름차순이다', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(200);
    const body = response.body as CollectionBody;
    const names = body.data.map((item) => item.attributes.name);
    expect(names).toEqual([...names].sort());
    expect(body.data.every((item) => item.type === 'exampleCategories')).toBe(true);
  });

  it('라벨 목록이 name 오름차순이고 type이 exampleTags다', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/tags').set('Accept', JSONAPI);

    expect(response.status).toBe(200);
    const body = response.body as CollectionBody;
    const names = body.data.map((item) => item.attributes.name);
    expect(names).toEqual([...names].sort());
    expect(body.data.every((item) => item.type === 'exampleTags')).toBe(true);
  });

  // 응답 attributes 의 키 집합은 `name` 하나뿐이다.
  //
  // 고치기 전에는 `createdAt`·`updatedAt` 이 더 나갔다. 정본(FastAPI)·Rails 는
  // `name` 하나이고, 프론트엔드의 자원 선언은 그 정책을 손으로 옮긴 거울이라
  // 키 집합이 갈리면 그 거울이 이 백엔드에서만 거짓이 된다.
  //
  // 시리얼라이저 단위 테스트가 선언을 지키고, 여기는 **문서로 나가는 것**을
  // 지킨다 - 응답 조립이 다시 필드를 붙일 수 있는 자리다.
  it.each([
    ['/api/v1/categories', 'exampleCategories'],
    ['/api/v1/tags', 'exampleTags'],
  ])('%s 목록의 attributes 는 name 하나뿐이다', async (path, type) => {
    const response = await request(app.getHttpServer()).get(path).set('Accept', JSONAPI);

    expect(response.status).toBe(200);
    const body = response.body as CollectionBody;
    expect(body.data.length).toBeGreaterThan(0);
    for (const item of body.data) {
      expect(item.type).toBe(type);
      expect(Object.keys(item.attributes)).toEqual(['name']);
    }
  });

  it.each(['/api/v1/categories', '/api/v1/tags'])(
    '%s 단건의 attributes 도 name 하나뿐이다',
    async (path) => {
      const list = await request(app.getHttpServer()).get(path).set('Accept', JSONAPI);
      const id = (list.body as CollectionBody).data[0]?.id;
      expect(id).toBeDefined();

      const response = await request(app.getHttpServer())
        .get(`${path}/${String(id)}`)
        .set('Accept', JSONAPI);

      expect(response.status).toBe(200);
      expect(Object.keys((response.body as SingleBody).data.attributes)).toEqual(['name']);
    },
  );

  it('단건 조회가 self 링크를 낸다', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Accept', JSONAPI);
    const id = (list.body as CollectionBody).data[0]?.id;
    expect(id).toBeDefined();

    const response = await request(app.getHttpServer())
      .get(`/api/v1/categories/${String(id)}`)
      .set('Accept', JSONAPI);

    expect(response.status).toBe(200);
    expect((response.body as SingleBody).data.links?.self).toBe(`/api/v1/categories/${String(id)}`);
  });

  it('선언한 name 필터 두 연산자를 받는다', async () => {
    const exact = await request(app.getHttpServer())
      .get('/api/v1/categories?filter[name]=alpha')
      .set('Accept', JSONAPI);
    const contains = await request(app.getHttpServer())
      .get('/api/v1/categories?filter[name][contains]=lph')
      .set('Accept', JSONAPI);

    expect(exact.status).toBe(200);
    expect(contains.status).toBe(200);
    // exact 결과와의 완전한 동일성이 아니라 포함 여부를 본다 — 다른 스위트가 남긴
    // 'lph'를 담은 이름이 있어도(가능성은 낮지만 이 스위트가 배제를 보장하지 않는다)
    // 이 단언은 그 값에 의존하지 않는다.
    expect((contains.body as CollectionBody).data.map((item) => item.attributes.name)).toContain(
      'alpha',
    );
  });

  it('명시적 정렬이 실제로 순서를 뒤집는다', async () => {
    // 기본 정렬만 확인하면 sort= 파라미터가 무시돼도 통과한다.
    const ascending = await request(app.getHttpServer())
      .get('/api/v1/categories?sort=name')
      .set('Accept', JSONAPI);
    const descending = await request(app.getHttpServer())
      .get('/api/v1/categories?sort=-name')
      .set('Accept', JSONAPI);

    const up = (ascending.body as CollectionBody).data.map((item) => item.attributes.name);
    const down = (descending.body as CollectionBody).data.map((item) => item.attributes.name);
    expect(up.length).toBeGreaterThan(1);
    expect(down).toEqual([...up].reverse());
  });

  it('커서로 컬렉션을 끝까지 걷는다', async () => {
    const seen: string[] = [];
    let url: string | null = '/api/v1/categories?page[size]=1&page[after]=';
    while (url !== null) {
      const response = await request(app.getHttpServer()).get(url).set('Accept', JSONAPI);
      const body = response.body as CollectionBody;
      seen.push(...body.data.map((item) => item.attributes.name));
      url = body.links.next ?? null;
    }

    const all = await request(app.getHttpServer()).get('/api/v1/categories').set('Accept', JSONAPI);
    expect(seen).toEqual((all.body as CollectionBody).data.map((item) => item.attributes.name));
  });

  it('선언하지 않은 필터 연산자를 INVALID_FILTER로 거절한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/categories?filter[name][gt]=a')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_FILTER');
  });

  it('선언하지 않은 include를 INVALID_INCLUDE로 거절한다', async () => {
    // includes가 비어 있다. examples 역참조를 열면 순환이 생긴다.
    const response = await request(app.getHttpServer())
      .get('/api/v1/categories?include=examples')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_INCLUDE');
  });

  it('분류 컬렉션이 쓰기를 받지 않는다', async () => {
    // 정본(FastAPI)은 이 자리에서 405를 낸다. 이 저장소는 실측 결과 404다 —
    // Nest/Express가 같은 경로에 서로 다른 메서드로 등록된 라우트를 하나의 Route로
    // 묶어 method-not-allowed를 판정하지 않고, 매치되는 메서드가 없으면 그냥
    // catch-all not-found 핸들러로 떨어지기 때문이다(`route-registrar.ts`가 등록하는
    // 라우트는 메서드마다 별개의 Express 레이어다). 두 값 다 "이 메서드는 지원하지
    // 않는다"는 뜻을 전달하므로 이 차이 자체를 결함으로 보지 않지만, 실제 값과
    // 다르게 고정하면 이 테스트가 거짓으로 초록이 된다.
    const response = await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Accept', JSONAPI)
      .set('Content-Type', JSONAPI)
      .send(JSON.stringify({ data: { type: 'exampleCategories', attributes: { name: 'delta' } } }));

    expect(response.status).toBe(404);
    // 상태 코드만으로는 이 응답이 JSON:API 오류 문서인지, 아니면 APP_FILTER 배선이
    // 끊겨 나온 HTML/기본 404인지 구분하지 못한다. 이 코드는 Nest의 기본
    // NotFoundException이 exception-filter.ts의 normalize()를 거쳐 HTTP_ERROR로
    // 정규화된 값이다(실측).
    expect((response.body as ErrorBody).errors[0]?.code).toBe('HTTP_ERROR');
  });

  it('라벨 단건이 삭제를 받지 않는다', async () => {
    // 위 테스트와 같은 이유로 404다 — 정본은 405.
    const response = await request(app.getHttpServer())
      .delete('/api/v1/tags/00000000-0000-0000-0000-000000000000')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(404);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('HTTP_ERROR');
  });
});
