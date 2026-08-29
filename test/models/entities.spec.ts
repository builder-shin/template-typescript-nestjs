import { getMetadataArgsStorage } from 'typeorm';
import { Category } from '../../src/app/models/category.entity.js';
import { Example, EXAMPLE_STATUSES } from '../../src/app/models/example.entity.js';
import { ENTITIES } from '../../src/app/models/index.js';
import { Tag } from '../../src/app/models/tag.entity.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- getMetadataArgsStorage()의 target 타입이 Function이다
function tableFor(target: Function): string {
  const table = getMetadataArgsStorage().tables.find((entry) => entry.target === target);
  if (table?.name === undefined) {
    throw new Error(`no table metadata for ${target.name}`);
  }
  return table.name;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- getMetadataArgsStorage()의 target 타입이 Function이다
function columnNames(target: Function): string[] {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.options.name ?? column.propertyName)
    .sort();
}

describe('엔티티 등록', () => {
  it('ENTITIES가 세 엔티티를 명시적으로 담는다', () => {
    expect(ENTITIES).toHaveLength(3);
    expect(ENTITIES).toContain(Example);
    expect(ENTITIES).toContain(Category);
    expect(ENTITIES).toContain(Tag);
  });
});

describe('테이블 이름', () => {
  it('snake_case 복수형을 쓴다', () => {
    expect(tableFor(Example)).toBe('examples');
    expect(tableFor(Category)).toBe('categories');
    expect(tableFor(Tag)).toBe('tags');
  });
});

describe('Example 엔티티', () => {
  it('스펙이 정한 컬럼을 가진다', () => {
    expect(columnNames(Example)).toEqual(
      [
        'body',
        'category_id',
        'created_at',
        'id',
        'published_at',
        'status',
        'title',
        'updated_at',
      ].sort(),
    );
  });

  it('status 값 집합을 고정한다', () => {
    expect([...EXAMPLE_STATUSES].sort()).toEqual(['archived', 'draft', 'published']);
  });

  it('category to-one 관계를 선언한다', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (entry) => entry.target === Example && entry.propertyName === 'category',
    );
    expect(relation?.relationType).toBe('many-to-one');
  });

  it('tags to-many 관계를 선언한다', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (entry) => entry.target === Example && entry.propertyName === 'tags',
    );
    expect(relation?.relationType).toBe('many-to-many');
  });

  it('(created_at, id) 인덱스를 선언한다', () => {
    const indices = getMetadataArgsStorage().indices.filter((entry) => entry.target === Example);
    const columns = indices.map((entry) => (entry.columns as string[]).join(','));
    expect(columns).toContain('createdAt,id');
  });
});

describe('Category 엔티티', () => {
  it('스펙이 정한 컬럼을 가진다', () => {
    expect(columnNames(Category)).toEqual(['created_at', 'id', 'name', 'updated_at']);
  });
});

describe('Tag 엔티티', () => {
  it('스펙이 정한 컬럼을 가진다', () => {
    expect(columnNames(Tag)).toEqual(['created_at', 'id', 'name', 'updated_at']);
  });
});
