import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { executeList } from '../../src/app/jsonapi/query-compiler.js';
import { parseQuery } from '../../src/app/jsonapi/query.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

const DECLARED = Object.keys(EXAMPLE_SERIALIZER.relationships);

/** 결정적인 시각. 정렬과 커서 검증이 시각에 기대므로 고정한다. */
function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 30, 0, minutes, 0));
}

async function seedExamples(manager: EntityManager): Promise<{ category: Category; tag: Tag }> {
  const category = await manager.save(manager.create(Category, { name: '분류' }));
  const tag = await manager.save(manager.create(Tag, { name: '라벨' }));
  // createdAt은 @CreateDateColumn이라 저장 시각이 들어간다. 정렬을 결정적으로 만들려고
  // 저장 뒤에 직접 갱신한다.
  for (let index = 0; index < 5; index += 1) {
    const saved = await manager.save(
      manager.create(Example, {
        title: `제목 ${String(index)}`,
        status: index % 2 === 0 ? 'draft' : 'published',
        categoryId: index < 3 ? category.id : null,
        publishedAt: index % 2 === 0 ? null : at(index),
        tags: index === 0 ? [tag] : [],
      }),
    );
    await manager.update(Example, { id: saved.id }, { createdAt: at(index) });
  }
  return { category, tag };
}

function list(manager: EntityManager): SelectQueryBuilder<Example> {
  return manager.createQueryBuilder(Example, 'e');
}

/**
 * 던져진 `JsonApiError`를 받아 온다.
 *
 * `rejects.toThrow(/.../)`는 `Error.message`를 본다. `JsonApiError.message`는 언제나
 * 카탈로그의 제목이고 구체적인 사유는 `detail`에 있으므로, 사유를 확인하려면 오류
 * 객체를 직접 받아야 한다. `test/jsonapi/cursor.spec.ts`의 `caught`와 같은 방식이다.
 */
async function caught(run: () => Promise<unknown>): Promise<JsonApiError> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('executeList — 필터', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('exact 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'filter[status]': 'draft' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(3);
      expect(result.items.every((item) => item.status === 'draft')).toBe(true);
    });
  });

  it('contains 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[title][contains]': '목 1' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(1);
    });
  });

  it('contains는 부분 일치를 리터럴로 다룬다', async () => {
    // `%`가 그대로 새면 사용자가 와일드카드를 주입할 수 있다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'filter[title][contains]': '%' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(0);
    });
  });

  it('in 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[status][in]': 'draft,published' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(5);
    });
  });

  it('isNull 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const truthy = parseQuery(
        { 'filter[category][isNull]': 'true' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager), 'e', truthy, EXAMPLE_SERIALIZER)).items,
      ).toHaveLength(2);
      const falsy = parseQuery(
        { 'filter[category][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect((await executeList(list(manager), 'e', falsy, EXAMPLE_SERIALIZER)).items).toHaveLength(
        3,
      );
    });
  });

  it('gt/gte/lt/lte 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[createdAt][gte]': at(3).toISOString() },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).items,
      ).toHaveLength(2);
    });
  });

  it('공개 이름 category가 FK 컬럼을 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { category } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[category]': category.id },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).items,
      ).toHaveLength(3);
    });
  });

  it('여러 필터를 AND로 묶는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[status]': 'draft', 'filter[category][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).items,
      ).toHaveLength(2);
    });
  });
});

describe('executeList — 정렬과 include', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('기본 정렬은 createdAt 내림차순이다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.map((item) => item.title)).toEqual([
        '제목 4',
        '제목 3',
        '제목 2',
        '제목 1',
        '제목 0',
      ]);
    });
  });

  it('sort로 정렬을 바꾼다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ sort: 'title' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.map((item) => item.title)).toEqual([
        '제목 0',
        '제목 1',
        '제목 2',
        '제목 3',
        '제목 4',
      ]);
    });
  });

  it('include가 to-one 관계를 함께 읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { include: 'category', 'filter[category][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.every((item) => item.category instanceof Category)).toBe(true);
    });
  });

  it('include가 to-many 관계를 함께 읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ include: 'tags', sort: 'title' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items[0]?.tags).toHaveLength(1);
      expect(result.items[1]?.tags).toHaveLength(0);
    });
  });

  it('include하지 않은 관계는 읽지 않는다', async () => {
    // 로드되지 않은 관계는 undefined여야 시리얼라이저가 linkage를 생략한다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items[0]?.category).toBeUndefined();
      expect(result.items[0]?.tags).toBeUndefined();
    });
  });

  it('to-many를 include해도 페이지 크기가 흔들리지 않는다', async () => {
    // 조인이 행을 늘리면 한 페이지가 조용히 줄어든다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { include: 'tags', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });
});

describe('executeList — offset 페이지네이션', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('요청 크기만큼 자르고 다음 페이지 존재를 알려 준다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'page[size]': '2' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });

  it('마지막 페이지에서는 hasMore가 거짓이다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[size]': '2', 'page[number]': '3' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });
  });

  it('totals를 요청하지 않으면 총 개수를 세지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.totalCount).toBeUndefined();
    });
  });

  it('totals를 요청하면 필터를 반영한 총 개수를 낸다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[totals]': 'true', 'page[size]': '2', 'filter[status]': 'draft' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.totalCount).toBe(3);
      expect(result.items).toHaveLength(2);
    });
  });

  it('to-many를 include해도 총 개수가 부풀지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[totals]': 'true', include: 'tags' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect((await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).totalCount).toBe(
        5,
      );
    });
  });
});

describe('executeList — cursor 페이지네이션', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('빈 after는 컬렉션 처음부터 읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.map((item) => item.title)).toEqual(['제목 4', '제목 3']);
      expect(result.hasMore).toBe(true);
    });
  });

  it('커서를 따라가면 겹치거나 건너뛰지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const seen: string[] = [];
      let cursor = '';
      for (let round = 0; round < 3; round += 1) {
        const parsed = parseQuery(
          { 'page[after]': cursor, 'page[size]': '2' },
          EXAMPLE_QUERY_POLICY,
          DECLARED,
        );
        const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
        seen.push(...result.items.map((item) => item.title));
        if (result.lastCursor === undefined) {
          break;
        }
        cursor = result.lastCursor;
      }
      expect(seen).toEqual(['제목 4', '제목 3', '제목 2', '제목 1', '제목 0']);
    });
  });

  it('before는 뒤에서부터 읽고 순서를 유지한다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[before]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      // 정렬은 createdAt DESC이므로 끝은 가장 오래된 둘이고, 순서는 정렬 그대로다.
      expect(result.items.map((item) => item.title)).toEqual(['제목 1', '제목 0']);
    });
  });

  it('앞쪽에 행이 끼어들어도 커서가 같은 지점을 가리킨다', async () => {
    // OFFSET과 갈라지는 지점이다. OFFSET이었다면 한 행을 두 번 보게 된다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const first = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page1 = await executeList(list(manager), 'e', first, EXAMPLE_SERIALIZER);

      const inserted = await manager.save(manager.create(Example, { title: '끼어든 것' }));
      await manager.update(Example, { id: inserted.id }, { createdAt: at(99) });

      const cursor = page1.lastCursor;
      if (cursor === undefined) {
        throw new Error('커서가 없다');
      }
      const second = parseQuery(
        { 'page[after]': cursor, 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page2 = await executeList(list(manager), 'e', second, EXAMPLE_SERIALIZER);
      expect(page2.items.map((item) => item.title)).toEqual(['제목 2', '제목 1']);
    });
  });

  it('nullable 정렬과 커서를 함께 쓰면 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[after]': '', sort: 'publishedAt' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const error = await caught(() => executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER));
      expect(error.code).toBe('INVALID_PAGE');
      expect(error.detail).toMatch(/nullable sort/);
    });
  });

  it('정렬을 바꾼 뒤 예전 커서를 쓰면 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const first = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page1 = await executeList(list(manager), 'e', first, EXAMPLE_SERIALIZER);
      const cursor = page1.lastCursor;
      if (cursor === undefined) {
        throw new Error('커서가 없다');
      }
      const changed = parseQuery(
        { 'page[after]': cursor, sort: 'title' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const error = await caught(() =>
        executeList(list(manager), 'e', changed, EXAMPLE_SERIALIZER),
      );
      expect(error.code).toBe('INVALID_PAGE');
      expect(error.detail).toMatch(/different sort order/);
    });
  });

  it('손상된 커서는 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'page[after]': '!!!' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const error = await caught(() => executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER));
      expect(error.code).toBe('INVALID_PAGE');
      expect(error.detail).toMatch(/malformed/);
    });
  });
});
