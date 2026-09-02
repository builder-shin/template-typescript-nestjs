import { EXAMPLE_STATUSES } from '../../src/app/models/example.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import { isFilterOperator, MAX_PAGE_SIZE } from '../../src/app/schemas/query-policy.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';

describe('EXAMPLE_QUERY_POLICY filter', () => {
  it('허용 필드를 고정한다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.filters).sort()).toEqual([
      'category',
      'createdAt',
      'publishedAt',
      'status',
      'title',
    ]);
  });

  it('공개 이름 category를 FK 컬럼 property로 옮긴다', () => {
    // 밖에서는 관계 이름, 안에서는 FK. 두 이름을 갈라 두면 컬럼이 바뀌어도 API가
    // 흔들리지 않는다.
    expect(EXAMPLE_QUERY_POLICY.filters.category?.property).toBe('categoryId');
  });

  it('모든 필드가 알려진 연산자만 선언한다', () => {
    for (const field of Object.values(EXAMPLE_QUERY_POLICY.filters)) {
      expect(field.operators.length).toBeGreaterThan(0);
      for (const operator of field.operators) {
        expect(isFilterOperator(operator)).toBe(true);
      }
    }
  });

  it('status는 엔티티의 enum 값만 받는다', () => {
    // 정책의 허용 값과 저장 enum이 갈라지면 통과한 필터가 SQL에서 터진다.
    expect(EXAMPLE_QUERY_POLICY.filters.status?.type).toBe('enum');
    expect([...(EXAMPLE_QUERY_POLICY.filters.status?.values ?? [])].sort()).toEqual(
      [...EXAMPLE_STATUSES].sort(),
    );
  });

  it('enum이 아닌 필드는 values를 선언하지 않는다', () => {
    for (const [name, field] of Object.entries(EXAMPLE_QUERY_POLICY.filters)) {
      if (field.type !== 'enum') {
        // 실패했을 때 어느 필드인지 알 수 있도록 이름을 함께 단언한다.
        expect({ name, values: field.values }).toEqual({ name, values: undefined });
      }
    }
  });
});

describe('EXAMPLE_QUERY_POLICY sort', () => {
  it('허용 필드를 고정한다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.sorts).sort()).toEqual([
      'createdAt',
      'id',
      'publishedAt',
      'title',
    ]);
  });

  it('publishedAt만 nullable로 표시한다', () => {
    // nullable 정렬은 keyset 커서에서 거부된다(스펙 8.2). 이 표시가 틀리면
    // 커서가 행을 조용히 건너뛴다.
    expect(EXAMPLE_QUERY_POLICY.sorts.publishedAt?.nullable).toBe(true);
    expect(EXAMPLE_QUERY_POLICY.sorts.createdAt?.nullable).toBe(false);
    expect(EXAMPLE_QUERY_POLICY.sorts.title?.nullable).toBe(false);
    expect(EXAMPLE_QUERY_POLICY.sorts.id?.nullable).toBe(false);
  });

  it('기본 정렬은 createdAt 내림차순이다', () => {
    expect(EXAMPLE_QUERY_POLICY.defaultSort).toEqual([{ field: 'createdAt', direction: 'DESC' }]);
  });

  it('tie breaker는 id 오름차순이다', () => {
    expect(EXAMPLE_QUERY_POLICY.tieBreaker).toEqual({ field: 'id', direction: 'ASC' });
  });

  it('defaultSort와 tieBreaker가 sorts에 선언된 이름만 쓴다', () => {
    // 컴파일러는 sorts 표를 거쳐야 프로퍼티를 얻는다. 표에 없는 이름을 쓰면
    // 기본 정렬이 런타임에 터진다.
    const names = Object.keys(EXAMPLE_QUERY_POLICY.sorts);
    for (const term of EXAMPLE_QUERY_POLICY.defaultSort) {
      expect(names).toContain(term.field);
    }
    expect(names).toContain(EXAMPLE_QUERY_POLICY.tieBreaker.field);
  });
});

describe('EXAMPLE_QUERY_POLICY include', () => {
  it('시리얼라이저가 선언한 관계만 허용한다', () => {
    // 스펙 8.1: include는 시리얼라이저 선언과 정책 양쪽에서 허용되어야 한다.
    // 정책에만 있는 경로는 영원히 통과할 수 없으므로 선언 자체가 잘못이다.
    const declared = Object.keys(EXAMPLE_SERIALIZER.relationships);
    for (const path of EXAMPLE_QUERY_POLICY.includes) {
      expect(declared).toContain(path);
    }
  });

  it('category와 tags를 연다', () => {
    expect([...EXAMPLE_QUERY_POLICY.includes].sort()).toEqual(['category', 'tags']);
  });
});

describe('EXAMPLE_QUERY_POLICY 페이지', () => {
  it('기본 페이지 크기가 최대치를 넘지 않는다', () => {
    expect(EXAMPLE_QUERY_POLICY.defaultPageSize).toBeGreaterThan(0);
    expect(EXAMPLE_QUERY_POLICY.defaultPageSize).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });
});
