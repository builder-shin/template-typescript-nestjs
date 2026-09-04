import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { EXAMPLE_RELATIONSHIPS } from '../../src/app/schemas/example.schemas.js';
import { CATEGORY_SERIALIZER } from '../../src/app/serializers/category.serializer.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
import { SERIALIZERS } from '../../src/app/serializers/index.js';
import { serializeResource } from '../../src/app/serializers/serializer.js';
import { TAG_SERIALIZER } from '../../src/app/serializers/tag.serializer.js';

const CREATED_AT = new Date('2026-08-30T01:02:03.000Z');
const UPDATED_AT = new Date('2026-08-30T04:05:06.000Z');
const PUBLISHED_AT = new Date('2026-08-30T07:08:09.000Z');

function example(overrides: Partial<Example> = {}): Example {
  // 엔티티 클래스를 실제로 만든다. `included` 조립이 `instanceof`로 좁히므로
  // 구조만 흉내 낸 객체로는 이 계약을 검증할 수 없다.
  //
  // `base`에 `Partial<Example>`을 명시하는 이유: 주석 없이 객체 리터럴을 쓰면
  // `status: 'published'`가 `string`으로 넓어져 `ExampleStatus`에 맞지 않는다.
  const base: Partial<Example> = {
    id: 'e1',
    title: '제목',
    body: '본문',
    status: 'published',
    publishedAt: PUBLISHED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    categoryId: null,
  };
  return Object.assign(new Example(), base, overrides);
}

function category(id: string, name: string): Category {
  return Object.assign(new Category(), {
    id,
    name,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  });
}

function tag(id: string, name: string): Tag {
  return Object.assign(new Tag(), { id, name, createdAt: CREATED_AT, updatedAt: UPDATED_AT });
}

describe('EXAMPLE_SERIALIZER', () => {
  it('JSON:API type과 resourcePath를 스펙대로 고정한다', () => {
    // resourcePath는 self 링크와 Location 헤더의 기준이고, Phase 4가 @Controller
    // 경로와 문자열까지 비교한다. 스펙 16장의 표와 어긋나면 안 된다.
    expect(EXAMPLE_SERIALIZER.type).toBe('examples');
    expect(EXAMPLE_SERIALIZER.resourcePath).toBe('/api/v1/examples');
  });

  it('공개 attribute 목록을 고정한다', () => {
    expect(Object.keys(EXAMPLE_SERIALIZER.attributes).sort()).toEqual([
      'body',
      'createdAt',
      'publishedAt',
      'status',
      'title',
      'updatedAt',
    ]);
  });

  it('내부 FK를 attribute로 내보내지 않는다', () => {
    // categoryId가 새면 클라이언트가 관계 라우트 대신 그 필드를 쓰게 되고
    // 관계 계약이 두 벌이 된다.
    expect(Object.keys(EXAMPLE_SERIALIZER.attributes)).not.toContain('categoryId');
  });

  it('category와 tags 관계를 cardinality와 함께 선언한다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.category?.cardinality).toBe('one');
    expect(EXAMPLE_SERIALIZER.relationships.tags?.cardinality).toBe('many');
  });

  it('관계마다 eager-load 경로를 선언한다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.category?.eagerLoad).toBe('category');
    expect(EXAMPLE_SERIALIZER.relationships.tags?.eagerLoad).toBe('tags');
  });

  it('날짜를 ISO 8601 문자열로 내보낸다', () => {
    const object = serializeResource(EXAMPLE_SERIALIZER, example());
    expect(object.attributes.createdAt).toBe('2026-08-30T01:02:03.000Z');
    expect(object.attributes.updatedAt).toBe('2026-08-30T04:05:06.000Z');
    expect(object.attributes.publishedAt).toBe('2026-08-30T07:08:09.000Z');
  });

  it('publishedAt이 null이면 null을 내보낸다', () => {
    const object = serializeResource(EXAMPLE_SERIALIZER, example({ publishedAt: null }));
    expect(object.attributes.publishedAt).toBeNull();
  });

  it('body가 null이면 null을 내보낸다', () => {
    expect(
      serializeResource(EXAMPLE_SERIALIZER, example({ body: null })).attributes.body,
    ).toBeNull();
  });

  it('status를 그대로 내보낸다', () => {
    expect(serializeResource(EXAMPLE_SERIALIZER, example()).attributes.status).toBe('published');
  });

  it('self 링크가 스펙 16장의 경로와 맞는다', () => {
    expect(serializeResource(EXAMPLE_SERIALIZER, example()).links?.self).toBe(
      '/api/v1/examples/e1',
    );
  });

  it('관계 링크가 스펙 16장의 경로와 맞는다', () => {
    const object = serializeResource(EXAMPLE_SERIALIZER, example());
    expect(object.relationships.category?.links).toEqual({
      self: '/api/v1/examples/e1/relationships/category',
      related: '/api/v1/examples/e1/category',
    });
    expect(object.relationships.tags?.links).toEqual({
      self: '/api/v1/examples/e1/relationships/tags',
      related: '/api/v1/examples/e1/tags',
    });
  });

  it('로드된 category의 linkage를 낸다', () => {
    const object = serializeResource(
      EXAMPLE_SERIALIZER,
      example({ category: category('c1', '안내서') }),
    );
    expect(object.relationships.category?.data).toEqual({ type: 'exampleCategories', id: 'c1' });
  });

  it('로드된 tags의 linkage를 낸다', () => {
    const object = serializeResource(
      EXAMPLE_SERIALIZER,
      example({ tags: [tag('t1', 'a'), tag('t2', 'b')] }),
    );
    expect(object.relationships.tags?.data).toEqual([
      { type: 'exampleTags', id: 't1' },
      { type: 'exampleTags', id: 't2' },
    ]);
  });
});

describe('CATEGORY_SERIALIZER / TAG_SERIALIZER', () => {
  it('include 전용이므로 resourcePath가 없다', () => {
    // 스펙 16장에 categories·tags 단건 라우트가 없다. self 링크를 지어내면
    // 클라이언트가 404를 따라간다.
    expect(CATEGORY_SERIALIZER.resourcePath).toBeUndefined();
    expect(TAG_SERIALIZER.resourcePath).toBeUndefined();
  });

  it('JSON:API type을 고정한다', () => {
    expect(CATEGORY_SERIALIZER.type).toBe('exampleCategories');
    expect(TAG_SERIALIZER.type).toBe('exampleTags');
  });

  it('공개 attribute 목록을 고정한다', () => {
    expect(Object.keys(CATEGORY_SERIALIZER.attributes).sort()).toEqual([
      'createdAt',
      'name',
      'updatedAt',
    ]);
    expect(Object.keys(TAG_SERIALIZER.attributes).sort()).toEqual([
      'createdAt',
      'name',
      'updatedAt',
    ]);
  });

  it('링크 없이 직렬화된다', () => {
    const object = serializeResource(CATEGORY_SERIALIZER, category('c1', '안내서'));
    expect(object.links).toBeUndefined();
    expect(object.attributes.name).toBe('안내서');
  });
});

describe('관계 대상 시리얼라이저', () => {
  it('category 관계 대상이 exampleCategories 시리얼라이저다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.category?.target().type).toBe('exampleCategories');
  });

  it('tags 관계 대상이 exampleTags 시리얼라이저다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.tags?.target().type).toBe('exampleTags');
  });

  it('엔티티가 아닌 값을 받으면 던진다', () => {
    // `serializeUnknown`은 타입을 지운 진입점이다. 좁히기를 빠뜨리면 엉뚱한 객체가
    // 조용히 직렬화되므로, 좁히기가 실제로 걸리는지 확인한다.
    const target = EXAMPLE_SERIALIZER.relationships.category?.target();
    if (target === undefined) {
      throw new Error('category 관계가 없다');
    }
    expect(() => target.serializeUnknown({ id: 'c1', name: '흉내' })).toThrow(TypeError);
  });
});

describe('SERIALIZERS 등록', () => {
  it('세 시리얼라이저를 명시적으로 담는다', () => {
    expect(SERIALIZERS.map((serializer) => serializer.type).sort()).toEqual([
      'exampleCategories',
      'exampleTags',
      'examples',
    ]);
  });
});

describe('읽기와 쓰기가 같은 자원 타입을 쓴다', () => {
  it('EXAMPLE_RELATIONSHIPS의 type이 시리얼라이저가 내보내는 type과 같다', () => {
    // 시리얼라이저는 내보내고 EXAMPLE_RELATIONSHIPS는 받는다. 둘이 갈라지면
    // 응답이 광고한 linkage를 그대로 되돌려보내는 요청이 409로 거절된다.
    expect(EXAMPLE_RELATIONSHIPS.category?.type).toBe(
      EXAMPLE_SERIALIZER.relationships.category?.target().type,
    );
    expect(EXAMPLE_RELATIONSHIPS.tags?.type).toBe(
      EXAMPLE_SERIALIZER.relationships.tags?.target().type,
    );
  });
});
