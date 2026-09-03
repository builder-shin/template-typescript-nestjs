import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { isFilterKey, parseFilters } from '../../src/app/jsonapi/filter.js';
import type { FilterFieldPolicy, QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {
    title: { property: 'title', type: 'string', operators: ['exact', 'contains'] },
    size: { property: 'size', type: 'number', operators: ['exact', 'gt', 'lte'] },
    active: { property: 'active', type: 'boolean', operators: ['exact'] },
    category: { property: 'categoryId', type: 'uuid', operators: ['exact', 'in', 'isNull'] },
    createdAt: { property: 'createdAt', type: 'timestamp', operators: ['gte', 'lt'] },
    status: {
      property: 'status',
      type: 'enum',
      operators: ['exact', 'in'],
      values: ['draft', 'published'],
    },
  },
  sorts: { id: { property: 'id', nullable: false } },
  includes: [],
  defaultSort: [{ field: 'id', direction: 'ASC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

const UUID = '0195c1a0-0000-7000-8000-000000000001';

/** `JsonApiError`가 아닌 오류는 그대로 다시 던져 테스트를 실패시킨다. */
function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('isFilterKey', () => {
  it('filter 키를 알아본다', () => {
    expect(isFilterKey('filter[title]')).toBe(true);
    expect(isFilterKey('filter[title][contains]')).toBe(true);
  });

  it('filter가 아닌 키를 거른다', () => {
    expect(isFilterKey('sort')).toBe(false);
    expect(isFilterKey('page[size]')).toBe(false);
    expect(isFilterKey('filter')).toBe(false);
    expect(isFilterKey('filter[]')).toBe(false);
  });
});

describe('parseFilters 기본 동작', () => {
  it('filter가 없으면 빈 배열이다', () => {
    expect(parseFilters({}, POLICY)).toEqual([]);
  });

  it('연산자를 생략하면 exact다', () => {
    expect(parseFilters({ 'filter[title]': '제목' }, POLICY)).toEqual([
      { parameter: 'filter[title]', property: 'title', operator: 'exact', value: '제목' },
    ]);
  });

  it('연산자를 명시하면 그대로 쓴다', () => {
    expect(parseFilters({ 'filter[title][contains]': '제' }, POLICY)).toEqual([
      {
        parameter: 'filter[title][contains]',
        property: 'title',
        operator: 'contains',
        value: '제',
      },
    ]);
  });

  it('공개 이름이 아니라 정책의 property를 쓴다', () => {
    // 사용자 입력이 열 이름이 되는 경로를 막는 계약이다.
    expect(parseFilters({ 'filter[category]': UUID }, POLICY)[0]?.property).toBe('categoryId');
  });

  it('여러 필터를 모두 담는다', () => {
    const conditions = parseFilters({ 'filter[title]': '제목', 'filter[size][gt]': '3' }, POLICY);
    expect(conditions).toHaveLength(2);
  });

  it('filter가 아닌 파라미터는 무시한다', () => {
    // 알 수 없는 파라미터 거부는 query.ts의 책임이다. 여기서 두 번 하지 않는다.
    expect(parseFilters({ sort: '-createdAt', 'page[size]': '10' }, POLICY)).toEqual([]);
  });
});

describe('parseFilters 값 변환', () => {
  it('number를 숫자로 바꾼다', () => {
    expect(parseFilters({ 'filter[size]': '42' }, POLICY)[0]?.value).toBe(42);
    expect(parseFilters({ 'filter[size][gt]': '-3.5' }, POLICY)[0]?.value).toBe(-3.5);
  });

  it('boolean을 참거짓으로 바꾼다', () => {
    expect(parseFilters({ 'filter[active]': 'true' }, POLICY)[0]?.value).toBe(true);
    expect(parseFilters({ 'filter[active]': 'false' }, POLICY)[0]?.value).toBe(false);
  });

  it('timestamp를 Date로 바꾼다', () => {
    const value = parseFilters({ 'filter[createdAt][gte]': '2026-08-30T00:00:00Z' }, POLICY)[0]
      ?.value;
    expect(value).toBeInstanceOf(Date);
    expect(value instanceof Date ? value.toISOString() : '').toBe('2026-08-30T00:00:00.000Z');
  });

  it('in은 쉼표로 나눠 배열로 만든다', () => {
    expect(parseFilters({ 'filter[status][in]': 'draft,published' }, POLICY)[0]?.value).toEqual([
      'draft',
      'published',
    ]);
  });

  it('in의 각 항목도 타입 변환을 거친다', () => {
    expect(parseFilters({ 'filter[category][in]': `${UUID},${UUID}` }, POLICY)[0]?.value).toEqual([
      UUID,
      UUID,
    ]);
  });

  it('isNull은 참거짓을 값으로 받는다', () => {
    expect(parseFilters({ 'filter[category][isNull]': 'true' }, POLICY)[0]?.value).toBe(true);
    expect(parseFilters({ 'filter[category][isNull]': 'false' }, POLICY)[0]?.value).toBe(false);
  });
});

describe('parseFilters 거부', () => {
  it('선언되지 않은 필드를 INVALID_FILTER로 거부한다', () => {
    const error = caught(() => parseFilters({ 'filter[secret]': 'x' }, POLICY));
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.source).toEqual({ parameter: 'filter[secret]' });
  });

  it('허용되지 않은 연산자를 거부한다', () => {
    const error = caught(() => parseFilters({ 'filter[title][gt]': 'x' }, POLICY));
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.source).toEqual({ parameter: 'filter[title][gt]' });
  });

  it('알 수 없는 연산자 이름을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[title][like]': 'x' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('같은 파라미터가 두 번 오면 거부한다', () => {
    // Node는 중복 키를 배열로 준다. 조용히 하나만 쓰면 어느 쪽이 적용됐는지 알 수 없다.
    expect(caught(() => parseFilters({ 'filter[title]': ['a', 'b'] }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('숫자가 아닌 number 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[size]': '삼' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('참거짓이 아닌 boolean 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[active]': '1' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('UUID가 아닌 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[category]': 'not-a-uuid' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('ISO 8601이 아닌 timestamp를 거부한다', () => {
    // `new Date('2026')`은 통과해 버린다. 느슨한 파싱은 사용자가 의도한 범위와
    // 실제 범위를 조용히 갈라놓는다.
    expect(caught(() => parseFilters({ 'filter[createdAt][gte]': '2026' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
    expect(
      caught(() => parseFilters({ 'filter[createdAt][gte]': '2026-13-40T00:00:00Z' }, POLICY)).code,
    ).toBe('INVALID_FILTER');
  });

  it('enum에 없는 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[status]': 'unknown' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('in의 항목 하나만 틀려도 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[status][in]': 'draft,unknown' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('in에 빈 목록을 거부한다', () => {
    // 빈 IN은 언제나 거짓이라 결과가 항상 비는데, 사용자는 필터가 무시됐다고 읽는다.
    expect(caught(() => parseFilters({ 'filter[status][in]': '' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('isNull에 참거짓이 아닌 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[category][isNull]': 'yes' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });
});

describe('parseFilters 정책 선언 오류', () => {
  it('string이 아닌 필드에 contains를 선언하면 TypeError다', () => {
    // 컴파일러는 contains를 ILIKE로 옮긴다. 텍스트가 아닌 컬럼에 걸면 PostgreSQL이
    // 거절해 500이 되는데, 사용자가 고칠 수 없는 것을 400으로 돌려주면 진단이 엉뚱한
    // 데로 간다. enum도 텍스트가 아니다 — PostgreSQL enum 컬럼에 ILIKE는 실패한다.
    const declare = (field: FilterFieldPolicy): QueryPolicy => ({
      ...POLICY,
      filters: { ...POLICY.filters, broken: field },
    });
    const cases: readonly FilterFieldPolicy[] = [
      { property: 'createdAt', type: 'timestamp', operators: ['contains'] },
      { property: 'size', type: 'number', operators: ['contains'] },
      { property: 'categoryId', type: 'uuid', operators: ['contains'] },
      { property: 'status', type: 'enum', operators: ['contains'], values: ['draft'] },
    ];
    for (const field of cases) {
      expect(() => parseFilters({ 'filter[broken][contains]': 'x' }, declare(field))).toThrow(
        TypeError,
      );
    }
  });

  it('string 필드의 contains는 그대로 통과한다', () => {
    // 가드가 너무 넓게 잡히면 정상 경로가 통째로 막힌다.
    expect(parseFilters({ 'filter[title][contains]': '가' }, POLICY)).toEqual([
      {
        parameter: 'filter[title][contains]',
        property: 'title',
        operator: 'contains',
        value: '가',
      },
    ]);
  });

  it('정책이 열지 않은 contains는 여전히 INVALID_FILTER다', () => {
    // 선언 오류(TypeError)와 요청 오류(JsonApiError)를 갈라야 한다. size는 contains를
    // 선언하지 않았으므로 이것은 사용자가 잘못 보낸 요청이다.
    expect(caught(() => parseFilters({ 'filter[size][contains]': '1' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });
});
