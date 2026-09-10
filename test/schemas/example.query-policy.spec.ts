import { EXAMPLE_STATUSES } from '../../src/app/models/example.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import { isFilterOperator, MAX_PAGE_SIZE } from '../../src/app/schemas/query-policy.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';

describe('EXAMPLE_QUERY_POLICY filter', () => {
  it('스펙이 정한 필터만 연다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.filters).sort()).toEqual([
      'category.id',
      'createdAt',
      'score',
      'status',
      'title',
    ]);
  });

  it('category.id 필터가 FK 컬럼을 가리킨다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters['category.id']).toEqual({
      property: 'categoryId',
      type: 'uuid',
      operators: ['exact', 'in', 'isNull'],
    });
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

  it('createdAt 필터가 exact를 연다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters.createdAt?.operators).toEqual([
      'exact',
      'gt',
      'gte',
      'lt',
      'lte',
    ]);
  });

  it('score 필터가 여섯 연산자를 연다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters.score?.operators).toEqual([
      'exact',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
    ]);
  });

  it('title 필터가 exact·contains를 연다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters.title?.operators).toEqual(['exact', 'contains']);
  });

  it('status 필터가 exact·in을 연다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters.status?.operators).toEqual(['exact', 'in']);
  });
});

describe('EXAMPLE_QUERY_POLICY sort', () => {
  it('스펙이 정한 정렬만 연다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.sorts).sort()).toEqual([
      'createdAt',
      'score',
      'status',
      'title',
      'updatedAt',
    ]);
  });

  it('id는 tie breaker 전용이고 공개 정렬이 아니다', () => {
    // 정본의 공개 정렬에 id가 없다. 열어 두면 `sort=id`가 200을 내고 정본은
    // INVALID_SORT를 내어 wire가 갈라진다.
    expect(EXAMPLE_QUERY_POLICY.sorts.id).toBeUndefined();
    expect(EXAMPLE_QUERY_POLICY.tieBreaker).toEqual({ field: 'id', direction: 'ASC' });
  });

  it('nullable 정렬을 열지 않는다', () => {
    for (const sort of Object.values(EXAMPLE_QUERY_POLICY.sorts)) {
      expect(sort.nullable).toBe(false);
    }
  });

  it('기본 정렬은 createdAt 내림차순이다', () => {
    expect(EXAMPLE_QUERY_POLICY.defaultSort).toEqual([{ field: 'createdAt', direction: 'DESC' }]);
  });

  it('tie breaker는 id 오름차순이다', () => {
    expect(EXAMPLE_QUERY_POLICY.tieBreaker).toEqual({ field: 'id', direction: 'ASC' });
  });

  it('defaultSort가 sorts에 선언된 이름만 쓴다', () => {
    // 컴파일러는 sorts 표를 거쳐야 프로퍼티를 얻는다. 표에 없는 이름을 쓰면
    // 기본 정렬이 런타임에 터진다. tieBreaker는 예외다 — id는 tie breaker
    // 전용이라 공개 정렬 표(sorts)에 없어도 되도록 정책이 의도한 것이다.
    const names = Object.keys(EXAMPLE_QUERY_POLICY.sorts);
    for (const term of EXAMPLE_QUERY_POLICY.defaultSort) {
      expect(names).toContain(term.field);
    }
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

  it('기본 페이지 크기가 정본과 같은 20이다', () => {
    // page[size] 없이 목록을 부르면 25건과 20건으로 갈린다. wire에 그대로 드러난다.
    expect(EXAMPLE_QUERY_POLICY.defaultPageSize).toBe(20);
  });
});
