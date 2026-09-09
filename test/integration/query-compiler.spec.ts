import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { executeList } from '../../src/app/jsonapi/query-compiler.js';
import type { ListResult } from '../../src/app/jsonapi/query-compiler.js';
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

/**
 * `seedExamples`가 만든 5행의 id.
 *
 * `list()`가 이 id 집합으로 질의를 좁히는 근거가 된다 — 아래 `list()` docstring 참고.
 */
async function seedExamples(
  manager: EntityManager,
): Promise<{ category: Category; tag: Tag; exampleIds: string[] }> {
  const category = await manager.save(manager.create(Category, { name: '분류' }));
  const tag = await manager.save(manager.create(Tag, { name: '라벨' }));
  const exampleIds: string[] = [];
  // createdAt은 @CreateDateColumn이라 저장 시각이 들어간다. 정렬을 결정적으로 만들려고
  // 저장 뒤에 직접 갱신한다.
  for (let index = 0; index < 5; index += 1) {
    const saved = await manager.save(
      manager.create(Example, {
        title: `제목 ${String(index)}`,
        status: index % 2 === 0 ? 'draft' : 'active',
        score: index * 20,
        categoryId: index < 3 ? category.id : null,
        tags: index === 0 ? [tag] : [],
      }),
    );
    await manager.update(Example, { id: saved.id }, { createdAt: at(index) });
    exampleIds.push(saved.id);
  }
  return { category, tag, exampleIds };
}

/**
 * `id IN (:...ids)`로 좁힌 질의 빌더.
 *
 * **왜 좁히는가(실측으로 드러난 결함, `docs/superpowers/rulings/2026-09-02-phase7-rulings.md`
 * 부록 30번 참고).** 이 파일의 모든 테스트는 `withRollback`으로 격리되므로 자기가 만든
 * 행은 롤백되어 서로에게 보이지 않는다 — 그런데 그것이 "이 질의가 보는 것이 내가 만든
 * 행뿐"이라는 뜻은 아니다. `withRollback`은 READ COMMITTED 트랜잭션이라, **다른
 * 커넥션이 커밋한 행**은 이 트랜잭션 안에서도 그대로 보인다. `jobs-queue.spec.ts`의
 * 테스트 하나가 워커의 실제 처리를 증명하려고 진짜 `Example` 행을 커밋하는데, 그
 * 스위트가 잡는 `acquireCommitLock`은 **같은 잠금을 잡는 다른 스위트**하고만 직렬화할
 * 뿐이고 이 파일은 그 잠금을 잡지 않는다(잡을 이유가 없었다 — 이 파일은 스스로는 아무
 * 것도 커밋하지 않으니까). 그 결과 이 파일의 스코프 없는 질의(특히 필터가 없거나 느슨한
 * 것들)가 그 외부 커밋 행을 우연히 집어 개수·순서 단언이 흔들릴 수 있다 — 실측: 격리
 * 없이 돌리면 "isNull 필터로 거른다"가 기대 2, 받음 3으로 깨진다(세 번째 행이 그
 * 외부에서 커밋된 행이었다).
 *
 * 고치는 방법은 잠금을 넓히는 것(모든 `withRollback` 스위트가 잠금을 잡게 하는 것)이
 * 아니라 **읽는 쪽을 스스로 안전하게 만드는 것**이다 — 공유 테이블에 대한 스코프 없는
 * 단언은 다른 커밋 스위트가 몇 개든 원래도 안전한 적이 없었다. `id IN (:...ids)`로
 * 좁히면 이 파일이 스스로 만든 행 이외에는 무엇이 테이블에 있든(외부 커밋이든, 다음에
 * 늘어날 또 다른 커밋 스위트든) 결과가 흔들리지 않는다.
 */
function list(manager: EntityManager, ids: readonly string[]): SelectQueryBuilder<Example> {
  return manager.createQueryBuilder(Example, 'e').where('e.id IN (:...ids)', { ids });
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
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({ 'filter[status]': 'draft' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(3);
      expect(result.items.every((item) => item.status === 'draft')).toBe(true);
    });
  });

  it('contains 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[title][contains]': '목 1' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(1);
    });
  });

  it('contains는 부분 일치를 리터럴로 다룬다', async () => {
    // `%`가 그대로 새면 사용자가 와일드카드를 주입할 수 있다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({ 'filter[title][contains]': '%' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(0);
    });
  });

  it('contains는 와일드카드 문자를 리터럴로 찾는다', async () => {
    // "0행"만 단언하면 이중 이스케이프처럼 잘못된 구현도 통과한다. 실제로 그 글자를
    // 가진 행이 찾아지는지, 그리고 그것만 찾아지는지 함께 본다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const percent = await manager.save(
        manager.create(Example, { title: '할인 50% 적용', score: 0 }),
      );
      const underscore = await manager.save(
        manager.create(Example, { title: 'snake_case 규칙', score: 0 }),
      );
      const backslash = await manager.save(
        manager.create(Example, { title: '경로 C:\\temp 안내', score: 0 }),
      );
      const ids = [...exampleIds, percent.id, underscore.id, backslash.id];

      const titles = async (value: string): Promise<string[]> => {
        const parsed = parseQuery(
          { 'filter[title][contains]': value },
          EXAMPLE_QUERY_POLICY,
          DECLARED,
        );
        const result = await executeList(list(manager, ids), 'e', parsed, EXAMPLE_SERIALIZER);
        return result.items.map((item) => item.title);
      };

      expect(await titles('%')).toEqual(['할인 50% 적용']);
      expect(await titles('_')).toEqual(['snake_case 규칙']);
      expect(await titles('\\')).toEqual(['경로 C:\\temp 안내']);
    });
  });

  it('in 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[status][in]': 'draft,active' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(5);
    });
  });

  it('isNull 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const truthy = parseQuery(
        { 'filter[category.id][isNull]': 'true' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager, exampleIds), 'e', truthy, EXAMPLE_SERIALIZER)).items,
      ).toHaveLength(2);
      const falsy = parseQuery(
        { 'filter[category.id][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager, exampleIds), 'e', falsy, EXAMPLE_SERIALIZER)).items,
      ).toHaveLength(3);
    });
  });

  it('gt/gte/lt/lte 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const count = async (query: Record<string, string>): Promise<number> => {
        const parsed = parseQuery(query, EXAMPLE_QUERY_POLICY, DECLARED);
        return (await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER)).items
          .length;
      };
      expect(await count({ 'filter[createdAt][gte]': at(3).toISOString() })).toBe(2);
      expect(await count({ 'filter[createdAt][gt]': at(3).toISOString() })).toBe(1);
      expect(await count({ 'filter[createdAt][lt]': at(2).toISOString() })).toBe(2);
      expect(await count({ 'filter[createdAt][lte]': at(2).toISOString() })).toBe(3);
    });
  });

  // 프론트엔드가 하루의 끝을 `T23:59:59.999999+00:00`으로 보낸다. 소수 초를
  // 3자리로 막아 두었을 때는 이 요청이 통째로 400 이었고, 화면에는 0행으로
  // 보였다(정본은 같은 요청에 두 행을 낸다).
  //
  // 마이크로초까지 실제로 비교되는지도 함께 잰다. 필터 값을 `Date`로 바꾸면
  // `.999999`가 `.999`로 잘려, 아래 `.999500` 행이 상한 안에 있는데도 빠진다.
  it('마이크로초 정밀도의 상한을 경계까지 지킨다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const [first] = exampleIds;
      if (first === undefined) {
        throw new Error('씨앗 행이 없다');
      }
      // TypeORM의 Date로는 마이크로초를 표현할 수 없으므로 직접 쓴다.
      await manager.query(`UPDATE examples SET created_at = $1 WHERE id = $2`, [
        '2026-08-30T23:59:59.999500+00:00',
        first,
      ]);

      const idsFor = async (query: Record<string, string>): Promise<string[]> => {
        const parsed = parseQuery(query, EXAMPLE_QUERY_POLICY, DECLARED);
        const result = await executeList(
          list(manager, exampleIds),
          'e',
          parsed,
          EXAMPLE_SERIALIZER,
        );
        return result.items.map((item) => item.id);
      };

      // 상한이 행보다 뒤 - 들어온다.
      await expect(
        idsFor({ 'filter[createdAt][lte]': '2026-08-30T23:59:59.999999+00:00' }),
      ).resolves.toContain(first);
      // 상한이 행보다 앞 - 빠진다. `.999`로 잘리면 이 두 단언이 같은 답을 내
      // 위쪽 단언이 속 빈 채로 통과한다.
      await expect(
        idsFor({ 'filter[createdAt][lte]': '2026-08-30T23:59:59.999000+00:00' }),
      ).resolves.not.toContain(first);
      // 경계 자기 자신은 포함이다(lte).
      await expect(
        idsFor({ 'filter[createdAt][lte]': '2026-08-30T23:59:59.999500+00:00' }),
      ).resolves.toContain(first);
    });
  });

  // 달력에 없는 날은 400 이어야 한다. 굴러간 값(2026-02-30 -> 03-02)으로 질의하면
  // 사용자가 요청한 범위와 실제 범위가 조용히 달라진다.
  it('달력에 없는 날짜를 DB까지 보내지 않는다', () => {
    expect(() =>
      parseQuery(
        { 'filter[createdAt][lte]': '2026-02-30T00:00:00Z' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      ),
    ).toThrow(JsonApiError);
  });

  it('공개 이름 category.id가 FK 컬럼을 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { category, exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[category.id]': category.id },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER)).items,
      ).toHaveLength(3);
    });
  });

  it('여러 필터를 AND로 묶는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[status]': 'draft', 'filter[category.id][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER)).items,
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
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
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
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({ sort: 'title' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
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
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { include: 'category', 'filter[category.id][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.every((item) => item.category instanceof Category)).toBe(true);
    });
  });

  it('include한 to-one 관계가 비어 있으면 null로 온다', async () => {
    // 시리얼라이저는 undefined(미로드)와 null(없음)을 갈라 쓴다. 조인했는데 대상이
    // 없을 때 undefined가 오면 응답에서 linkage가 통째로 사라진다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { include: 'category', 'filter[category.id][isNull]': 'true' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(2);
      for (const item of result.items) {
        // `toBeNull`은 undefined를 통과시키지 않는다 — 이 테스트가 지키는 경계가 그것이다.
        expect(item.category).toBeNull();
      }
    });
  });

  it('include가 to-many 관계를 함께 읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({ include: 'tags', sort: 'title' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items[0]?.tags).toHaveLength(1);
      expect(result.items[1]?.tags).toHaveLength(0);
    });
  });

  it('include하지 않은 관계는 읽지 않는다', async () => {
    // 로드되지 않은 관계는 undefined여야 시리얼라이저가 linkage를 생략한다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items[0]?.category).toBeUndefined();
      expect(result.items[0]?.tags).toBeUndefined();
    });
  });

  it('to-many를 include해도 페이지 크기가 흔들리지 않는다', async () => {
    // 조인이 행을 늘리면 한 페이지가 조용히 줄어든다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { include: 'tags', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
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
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({ 'page[size]': '2' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });

  it('마지막 페이지에서는 hasMore가 거짓이다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[size]': '2', 'page[number]': '3' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });
  });

  it('totals를 요청하지 않으면 총 개수를 세지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.totalCount).toBeUndefined();
    });
  });

  it('totals를 요청하면 필터를 반영한 총 개수를 낸다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[totals]': 'true', 'page[size]': '2', 'filter[status]': 'draft' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.totalCount).toBe(3);
      expect(result.items).toHaveLength(2);
    });
  });

  it('to-many를 include해도 총 개수가 행 수만큼 부풀지 않는다', async () => {
    // 이 테스트가 고정하는 것은 결과값(조인 행 수가 아니라 자원 수)이지 COUNT를 언제
    // 실행하는지가 아니다. TypeORM이 조인이 있을 때 COUNT(DISTINCT)로 세므로 호출 순서를
    // 바꿔도 이 단언은 통과한다 — 순서는 비용 판단이고, 여기서 지켜지는 것은 계약이다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[totals]': 'true', include: 'tags' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect(
        (await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER)).totalCount,
      ).toBe(5);
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
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.map((item) => item.title)).toEqual(['제목 4', '제목 3']);
      expect(result.hasMore).toBe(true);
    });
  });

  it('커서를 따라가면 겹치거나 건너뛰지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const seen: string[] = [];
      let cursor = '';
      for (let round = 0; round < 3; round += 1) {
        const parsed = parseQuery(
          { 'page[after]': cursor, 'page[size]': '2' },
          EXAMPLE_QUERY_POLICY,
          DECLARED,
        );
        const result = await executeList(
          list(manager, exampleIds),
          'e',
          parsed,
          EXAMPLE_SERIALIZER,
        );
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
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[before]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      // 정렬은 createdAt DESC이므로 끝은 가장 오래된 둘이고, 순서는 정렬 그대로다.
      expect(result.items.map((item) => item.title)).toEqual(['제목 1', '제목 0']);
    });
  });

  it('앞쪽에 행이 끼어들어도 커서가 같은 지점을 가리킨다', async () => {
    // OFFSET과 갈라지는 지점이다. OFFSET이었다면 한 행을 두 번 보게 된다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const first = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page1 = await executeList(list(manager, exampleIds), 'e', first, EXAMPLE_SERIALIZER);

      const inserted = await manager.save(
        manager.create(Example, { title: '끼어든 것', score: 0 }),
      );
      await manager.update(Example, { id: inserted.id }, { createdAt: at(99) });
      // `inserted`는 이 테스트가 일부러 만든, 커서 이후에 끼어드는 행이다 — 범위에서
      // 빼면 이 테스트가 확인하려는 것(끼어든 행이 있어도 커서가 흔들리지 않는다) 자체가
      // 성립하지 않으므로 함께 넣는다.
      const ids = [...exampleIds, inserted.id];

      const cursor = page1.lastCursor;
      if (cursor === undefined) {
        throw new Error('커서가 없다');
      }
      const second = parseQuery(
        { 'page[after]': cursor, 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page2 = await executeList(list(manager, ids), 'e', second, EXAMPLE_SERIALIZER);
      expect(page2.items.map((item) => item.title)).toEqual(['제목 2', '제목 1']);
    });
  });

  it('제거된 publishedAt sort는 질의를 돌리기 전에 INVALID_SORT로 거부한다', () => {
    // publishedAt은 이제 정책에 없는 필드다. nullable 정렬과 커서 조합 자체를 질의를
    // 돌리기 전에 거부하는 경로의 검증(스펙 8.2)은 Task 4가 합성 정책으로 대체한다 —
    // 여기서는 사라진 필드가 여전히 질의를 돌리기 전에 거부된다는 것만 고정한다.
    let thrown: unknown;
    try {
      parseQuery({ 'page[after]': '', sort: 'publishedAt' }, EXAMPLE_QUERY_POLICY, DECLARED);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(JsonApiError);
    expect((thrown as JsonApiError).code).toBe('INVALID_SORT');
  });

  it('정렬을 바꾼 뒤 예전 커서를 쓰면 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const first = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page1 = await executeList(list(manager, exampleIds), 'e', first, EXAMPLE_SERIALIZER);
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
        executeList(list(manager, exampleIds), 'e', changed, EXAMPLE_SERIALIZER),
      );
      expect(error.code).toBe('INVALID_PAGE');
      expect(error.source).toEqual({ parameter: 'page[after]' });
    });
  });

  it('손상된 커서는 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const parsed = parseQuery({ 'page[after]': '!!!' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const error = await caught(() =>
        executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER),
      );
      expect(error.code).toBe('INVALID_PAGE');
      expect(error.source).toEqual({ parameter: 'page[after]' });
    });
  });

  it('page[before] 커서가 그 앞쪽 페이지를 정렬 순서 그대로 돌려준다', async () => {
    // Phase 4의 prev 링크가 내보내는 요청이다. 앞선 테스트들은 after 쪽만 지나므로
    // 역방향 keyset 비교식은 이 테스트가 없으면 한 번도 실행되지 않는다.
    await withRollback(dataSource, async (manager) => {
      const { exampleIds } = await seedExamples(manager);
      const page = async (params: Record<string, string>): Promise<ListResult<Example>> => {
        const parsed = parseQuery(params, EXAMPLE_QUERY_POLICY, DECLARED);
        return executeList(list(manager, exampleIds), 'e', parsed, EXAMPLE_SERIALIZER);
      };

      const first = await page({ 'page[after]': '', 'page[size]': '2' });
      const firstLast = first.lastCursor;
      if (firstLast === undefined) {
        throw new Error('첫 페이지의 커서가 없다');
      }

      const second = await page({ 'page[after]': firstLast, 'page[size]': '2' });
      expect(second.items.map((item) => item.title)).toEqual(['제목 2', '제목 1']);
      const secondFirst = second.firstCursor;
      if (secondFirst === undefined) {
        throw new Error('둘째 페이지의 첫 커서가 없다');
      }

      // 둘째 페이지의 첫 행보다 앞선 것들. 정렬은 createdAt DESC이므로 4, 3이다.
      const back = await page({ 'page[before]': secondFirst, 'page[size]': '2' });
      expect(back.items.map((item) => item.title)).toEqual(['제목 4', '제목 3']);
    });
  });
});
