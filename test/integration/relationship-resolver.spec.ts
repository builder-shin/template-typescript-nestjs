import type { DataSource } from 'typeorm';
import {
  resolveOne,
  resolveRelationships,
} from '../../src/app/controllers/concerns/relationship-resolver.js';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { EXAMPLE_RELATIONSHIPS } from '../../src/app/schemas/example.schemas.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

const MISSING = '0195c1a0-0000-7000-8000-0000000009ff';

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

describe('resolveRelationships', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it.each([
    [
      [
        { type: 'exampleTags', id: 'nope' },
        { type: 'wrong', id: MISSING },
      ],
      'RELATIONSHIP_RESOURCE_NOT_FOUND',
      '/data/0/id',
    ],
    [
      [
        { type: 'exampleTags', id: MISSING },
        { type: 'exampleTags', id: MISSING },
        { type: 'wrong', id: MISSING },
      ],
      'INVALID_JSONAPI_DOCUMENT',
      '/data/1/id',
    ],
    [
      [
        { type: 'exampleTags', id: MISSING },
        { type: 'wrong', id: MISSING },
      ],
      'TYPE_MISMATCH',
      '/data/1/type',
    ],
    [
      [
        { type: 'wrong', id: MISSING },
        { type: 'exampleTags', id: 'nope' },
      ],
      'TYPE_MISMATCH',
      '/data/0/type',
    ],
  ] as const)(
    'keeps identifier semantic order before existence queries: %j',
    async (data, code, pointer) => {
      const error = await caught(() =>
        resolveOne(
          dataSource.manager,
          { type: 'exampleTags', cardinality: 'many', model: Tag },
          { data },
          '/data',
        ),
      );
      expect(error.code).toBe(code);
      expect(error.source).toEqual({ pointer });
    },
  );

  it('to-one linkage를 실제 행으로 해석한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const category = await manager.save(manager.create(Category, { name: '분류' }));
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        category: { data: { type: 'exampleCategories', id: category.id } },
      });
      expect(resolved.toOne.category).toBeInstanceOf(Category);
    });
  });

  it('to-one linkage의 null은 해제다', async () => {
    await withRollback(dataSource, async (manager) => {
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        category: { data: null },
      });
      expect(resolved.toOne.category).toBeNull();
    });
  });

  it('to-many linkage를 실제 행으로 해석한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const first = await manager.save(manager.create(Tag, { name: 'ㄱ' }));
      const second = await manager.save(manager.create(Tag, { name: 'ㄴ' }));
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        tags: {
          data: [
            { type: 'exampleTags', id: first.id },
            { type: 'exampleTags', id: second.id },
          ],
        },
      });
      expect(resolved.toMany.tags).toHaveLength(2);
    });
  });

  it('to-many의 빈 배열은 전체 해제다', async () => {
    await withRollback(dataSource, async (manager) => {
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        tags: { data: [] },
      });
      expect(resolved.toMany.tags).toEqual([]);
    });
  });

  it('없는 대상은 RELATIONSHIP_RESOURCE_NOT_FOUND다', async () => {
    await withRollback(dataSource, async (manager) => {
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          category: { data: { type: 'exampleCategories', id: MISSING } },
        }),
      );
      expect(error.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
      expect(error.source).toEqual({ pointer: '/data/relationships/category/data/id' });
    });
  });

  it('모양이 깨진 id는 500이 아니라 404다', async () => {
    // uuid 컬럼에 uuid가 아닌 값을 넣으면 드라이버가 22P02로 죽는다. 가리킬 수 없는
    // id는 없는 자원을 가리킨 것이다.
    await withRollback(dataSource, async (manager) => {
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          category: { data: { type: 'exampleCategories', id: 'nope' } },
        }),
      );
      expect(error.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
    });
  });

  it('to-many에서 하나만 없어도 거부한다', async () => {
    // 일부만 붙이면 클라이언트가 보낸 집합과 저장된 집합이 갈라진다.
    await withRollback(dataSource, async (manager) => {
      const tag = await manager.save(manager.create(Tag, { name: 'ㄱ' }));
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          tags: {
            data: [
              { type: 'exampleTags', id: tag.id },
              { type: 'exampleTags', id: MISSING },
            ],
          },
        }),
      );
      expect(error.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
    });
  });

  it('쓰기로 열지 않은 관계를 거부한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          author: { data: { type: 'users', id: 'u1' } },
        }),
      );
      expect(error.code).toBe('INVALID_JSONAPI_DOCUMENT');
      expect(error.source).toEqual({ pointer: '/data/relationships/author' });
    });
  });

  it('linkage type이 다르면 TYPE_MISMATCH다', async () => {
    await withRollback(dataSource, async (manager) => {
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          tags: { data: [{ type: 'exampleCategories', id: MISSING }] },
        }),
      );
      expect(error.code).toBe('TYPE_MISMATCH');
    });
  });

  it('rejects duplicate relationship identifiers', async () => {
    await withRollback(dataSource, async (manager) => {
      const tag = await manager.save(manager.create(Tag, { name: 'duplicate-parity' }));
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          tags: {
            data: [
              { type: 'exampleTags', id: tag.id },
              { type: 'exampleTags', id: tag.id },
            ],
          },
        }),
      );
      expect(error.code).toBe('INVALID_JSONAPI_DOCUMENT');
      expect(error.source).toEqual({ pointer: '/data/relationships/tags/data/1/id' });
    });
  });

  it('입력에 없는 관계는 결과에도 없다', async () => {
    // "보내지 않은 관계"와 "비우라고 보낸 관계"를 가른다.
    await withRollback(dataSource, async (manager) => {
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {});
      expect(Object.keys(resolved.toOne)).toEqual([]);
      expect(Object.keys(resolved.toMany)).toEqual([]);
    });
  });
});
