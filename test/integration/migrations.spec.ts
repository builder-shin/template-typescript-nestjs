import type { DataSource } from 'typeorm';
import { createTestDataSource, truncateAll, withRollback } from '../db/fixture.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';

describe('마이그레이션 적용', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('스펙이 정한 테이블을 모두 만든다', async () => {
    const rows = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((row) => row.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['examples', 'categories', 'tags', 'example_tags']),
    );
  });

  it('example_status enum을 만든다', async () => {
    const rows = await dataSource.query<{ enumlabel: string }[]>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'example_status'
       ORDER BY enumlabel`,
    );
    expect(rows.map((row) => row.enumlabel)).toEqual(['archived', 'draft', 'published']);
  });

  it('(created_at, id) 인덱스를 만든다', async () => {
    const rows = await dataSource.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'examples'`,
    );
    expect(rows.map((row) => row.indexname)).toContain('IDX_examples_created_at_id');
  });

  it('적용 대기 중인 마이그레이션이 없다', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
  });

  it('엔티티 메타데이터가 실제 스키마와 어긋나지 않는다', async () => {
    // synchronize가 만들려는 SQL이 비어 있어야 엔티티와 마이그레이션이 일치한다.
    const sqlInMemory = await dataSource.driver.createSchemaBuilder().log();
    expect(sqlInMemory.upQueries).toHaveLength(0);
  });
});

describe('스키마 제약', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await truncateAll(dataSource);
    await dataSource.destroy();
  });

  it('Example을 저장하고 기본값을 적용한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const saved = await manager.save(manager.create(Example, { title: '제목' }));
      expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(saved.status).toBe('draft');
      expect(saved.body).toBeNull();
      expect(saved.categoryId).toBeNull();
      expect(saved.createdAt).toBeInstanceOf(Date);
    });
  });

  it('category 이름은 유일하다', async () => {
    await expect(
      withRollback(dataSource, async (manager) => {
        await manager.save(manager.create(Category, { name: '중복' }));
        await manager.save(manager.create(Category, { name: '중복' }));
      }),
    ).rejects.toThrow();
  });

  it('tag 이름은 유일하다', async () => {
    await expect(
      withRollback(dataSource, async (manager) => {
        await manager.save(manager.create(Tag, { name: '중복' }));
        await manager.save(manager.create(Tag, { name: '중복' }));
      }),
    ).rejects.toThrow();
  });

  it('category 삭제가 Example을 지우지 않고 FK만 푼다', async () => {
    await withRollback(dataSource, async (manager) => {
      const category = await manager.save(manager.create(Category, { name: '분류' }));
      const example = await manager.save(
        manager.create(Example, { title: '제목', categoryId: category.id }),
      );
      await manager.delete(Category, { id: category.id });
      const reloaded = await manager.findOneByOrFail(Example, { id: example.id });
      expect(reloaded.categoryId).toBeNull();
    });
  });

  it('Example 삭제가 조인 행을 함께 지운다', async () => {
    await withRollback(dataSource, async (manager) => {
      const tag = await manager.save(manager.create(Tag, { name: '라벨' }));
      const example = await manager.save(manager.create(Example, { title: '제목', tags: [tag] }));
      await manager.delete(Example, { id: example.id });
      const rows = await manager.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM example_tags WHERE example_id = $1`,
        [example.id],
      );
      // 인덱싱을 피한다 — 배열 전체를 비교하면 `noUncheckedIndexedAccess`에 걸리지 않고
      // "행이 정확히 하나"라는 것까지 함께 단언하게 된다.
      expect(rows).toEqual([{ count: 0 }]);
    });
  });

  it('to-many 관계를 저장하고 되읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const tags = await manager.save([
        manager.create(Tag, { name: 'a' }),
        manager.create(Tag, { name: 'b' }),
      ]);
      const example = await manager.save(manager.create(Example, { title: '제목', tags }));
      const reloaded = await manager.findOneOrFail(Example, {
        where: { id: example.id },
        relations: { tags: true },
      });
      expect(reloaded.tags?.map((tag) => tag.name).sort()).toEqual(['a', 'b']);
    });
  });

  it('허용되지 않은 status를 거부한다', async () => {
    await expect(
      withRollback(dataSource, async (manager) => {
        await manager.query(`INSERT INTO examples (title, status) VALUES ('제목', 'unknown')`);
      }),
    ).rejects.toThrow();
  });

  it('withRollback이 실제로 롤백한다', async () => {
    let createdId = '';
    await withRollback(dataSource, async (manager) => {
      const saved = await manager.save(manager.create(Example, { title: '사라질 것' }));
      createdId = saved.id;
    });
    const found = await dataSource.getRepository(Example).findOneBy({ id: createdId });
    expect(found).toBeNull();
  });
});
