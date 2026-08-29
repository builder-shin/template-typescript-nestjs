import type { DataSource } from 'typeorm';
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { SEED_CATEGORY_IDS, SEED_EXAMPLE_IDS, SEED_TAG_IDS, seed } from '../../src/db/seeds.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

describe('결정적 시드', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('고정 식별자를 선언한다', () => {
    const ids = [
      ...Object.values(SEED_CATEGORY_IDS),
      ...Object.values(SEED_TAG_IDS),
      ...Object.values(SEED_EXAMPLE_IDS),
    ];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('선언한 모든 행을 만든다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      expect(await manager.count(Category)).toBe(Object.keys(SEED_CATEGORY_IDS).length);
      expect(await manager.count(Tag)).toBe(Object.keys(SEED_TAG_IDS).length);
      expect(await manager.count(Example)).toBe(Object.keys(SEED_EXAMPLE_IDS).length);
    });
  });

  it('선언한 식별자를 그대로 쓴다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      for (const id of Object.values(SEED_CATEGORY_IDS)) {
        expect(await manager.findOneBy(Category, { id })).not.toBeNull();
      }
      for (const id of Object.values(SEED_EXAMPLE_IDS)) {
        expect(await manager.findOneBy(Example, { id })).not.toBeNull();
      }
    });
  });

  it('두 번 돌려도 행이 늘지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      const first = await manager.count(Example);
      await seed(manager);
      expect(await manager.count(Example)).toBe(first);
    });
  });

  it('두 번 돌려도 관계가 중복되지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      await seed(manager);
      // `query<T>(...)`의 명시적 제네릭 인자를 쓴다 — `(await ...) as unknown[]`은
      // 이 저장소의 typeorm 타입 선언 아래에서 `@typescript-eslint/no-unnecessary-type-assertion`에
      // 걸린다(어설션이 콜의 제네릭 T를 문맥으로 추론시켜 이미 같은 타입이 되기 때문).
      // Task 9가 같은 문제를 같은 방식으로 고쳤다(test/integration/migrations.spec.ts 참고).
      const rows = await manager.query<unknown[]>(
        `SELECT example_id, tag_id, COUNT(*)::int AS count
         FROM example_tags GROUP BY example_id, tag_id HAVING COUNT(*) > 1`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('시드 선언에 없는 조인 행은 다음 실행에서 사라진다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);

      const exampleId = SEED_EXAMPLE_IDS.gettingStarted;
      const strayTagId = SEED_TAG_IDS.postgres; // gettingStarted가 선언하지 않은 태그

      await manager.query(`INSERT INTO example_tags (example_id, tag_id) VALUES ($1, $2)`, [
        exampleId,
        strayTagId,
      ]);

      // 손으로 넣은 행이 실제로 들어갔는지 먼저 확인한다 — 이 단언이 없으면 아래 검사가
      // "원래부터 없었다"로도 통과해 공허해진다.
      const before = await manager.query<{ tag_id: string }[]>(
        `SELECT tag_id FROM example_tags WHERE example_id = $1`,
        [exampleId],
      );
      expect(before.map((row) => row.tag_id)).toContain(strayTagId);

      await seed(manager);

      const after = await manager.query<{ tag_id: string }[]>(
        `SELECT tag_id FROM example_tags WHERE example_id = $1`,
        [exampleId],
      );
      expect(after.map((row) => row.tag_id)).not.toContain(strayTagId);
      // 선언된 관계는 그대로 남아야 한다 — 전부 지우고 마는 구현도 위 단언은 통과한다.
      expect(after).toHaveLength(2);
    });
  });

  it('수정된 행을 선언 값으로 되돌린다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      const [id] = Object.values(SEED_EXAMPLE_IDS);
      if (id === undefined) {
        throw new Error('SEED_EXAMPLE_IDS는 비어 있을 수 없다');
      }
      const before = await manager.findOneByOrFail(Example, { id });
      await manager.update(Example, { id }, { title: '손으로 바꾼 제목' });
      await seed(manager);
      const after = await manager.findOneByOrFail(Example, { id });
      expect(after.title).toBe(before.title);
    });
  });

  it('Example에 관계를 연결한다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      const examples = await manager.find(Example, {
        relations: { tags: true, category: true },
      });
      expect(examples.some((example) => example.categoryId !== null)).toBe(true);
      expect(examples.some((example) => (example.tags?.length ?? 0) > 0)).toBe(true);
    });
  });

  it('트랜잭션을 스스로 열지 않는다 (호출자가 롤백할 수 있다)', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      expect(await manager.count(Example)).toBeGreaterThan(0);
    });
    // 롤백 뒤에는 아무것도 남지 않아야 한다.
    expect(await dataSource.getRepository(Example).count()).toBe(0);
  });
});
