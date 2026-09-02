import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  assertNoQueryParameters,
  parseQuery,
  parseRelatedCollectionQuery,
} from '../../src/app/jsonapi/query.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: { status: { property: 'status', type: 'string', operators: ['exact'] } },
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
    id: { property: 'id', nullable: false },
  },
  includes: ['category'],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

const DECLARED = ['category', 'tags'];

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

describe('parseQuery', () => {
  it('빈 질의도 기본 정렬과 기본 페이지를 낸다', () => {
    const parsed = parseQuery({}, POLICY, DECLARED);
    expect(parsed.filters).toEqual([]);
    expect(parsed.include).toEqual([]);
    expect(parsed.sort.map((term) => term.field)).toEqual(['createdAt', 'id']);
    expect(parsed.page).toEqual({ mode: 'offset', size: 25, number: 1, totals: false });
  });

  it('네 갈래를 함께 해석한다', () => {
    const parsed = parseQuery(
      {
        'filter[status]': 'draft',
        sort: '-createdAt',
        include: 'category',
        'page[size]': '5',
      },
      POLICY,
      DECLARED,
    );
    expect(parsed.filters).toHaveLength(1);
    expect(parsed.include).toEqual(['category']);
    expect(parsed.page.size).toBe(5);
  });
});

describe('parseQuery 거부', () => {
  it('알 수 없는 파라미터를 INVALID_QUERY_PARAMETER로 거부한다', () => {
    const error = caught(() => parseQuery({ q: '검색어' }, POLICY, DECLARED));
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'q' });
  });

  it('fields[...]를 거부한다', () => {
    // 희소 필드셋은 스펙 1.1의 비목표다. 조용히 무시하면 클라이언트는 적용됐다고 읽는다.
    const error = caught(() => parseQuery({ 'fields[examples]': 'title' }, POLICY, DECLARED));
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'fields[examples]' });
  });

  it('알 수 없는 page 하위 키를 거부한다', () => {
    expect(caught(() => parseQuery({ 'page[offset]': '10' }, POLICY, DECLARED)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
  });

  it('알 수 없는 파라미터를 값 오류보다 먼저 말한다', () => {
    // 오타 난 파라미터가 조용히 무시되는 것이 가장 흔한 사고다.
    const error = caught(() =>
      parseQuery({ q: '검색어', 'filter[status][gt]': 'x' }, POLICY, DECLARED),
    );
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
  });

  it('filter·sort·include·page 오류는 각자의 코드로 낸다', () => {
    expect(caught(() => parseQuery({ 'filter[secret]': 'x' }, POLICY, DECLARED)).code).toBe(
      'INVALID_FILTER',
    );
    expect(caught(() => parseQuery({ sort: 'secret' }, POLICY, DECLARED)).code).toBe(
      'INVALID_SORT',
    );
    expect(caught(() => parseQuery({ include: 'secret' }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
    expect(caught(() => parseQuery({ 'page[size]': '0' }, POLICY, DECLARED)).code).toBe(
      'INVALID_PAGE',
    );
  });
});

describe('parseRelatedCollectionQuery', () => {
  it('page[number]와 page[size]만 받는다', () => {
    expect(parseRelatedCollectionQuery({ 'page[number]': '2', 'page[size]': '5' }, POLICY)).toEqual(
      {
        mode: 'offset',
        size: 5,
        number: 2,
        totals: true,
      },
    );
  });

  it('총 개수를 언제나 낸다', () => {
    // 스펙 8.2: to-many 관계 URL은 meta.totalCount와 페이지 링크를 반환한다.
    expect(parseRelatedCollectionQuery({}, POLICY).totals).toBe(true);
  });

  it('filter를 거부한다', () => {
    const error = caught(() => parseRelatedCollectionQuery({ 'filter[status]': 'draft' }, POLICY));
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'filter[status]' });
  });

  it('sort와 include를 거부한다', () => {
    expect(caught(() => parseRelatedCollectionQuery({ sort: 'createdAt' }, POLICY)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
    expect(caught(() => parseRelatedCollectionQuery({ include: 'category' }, POLICY)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
  });

  it('커서 파라미터를 거부한다', () => {
    expect(caught(() => parseRelatedCollectionQuery({ 'page[after]': '' }, POLICY)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
  });
});

describe('assertNoQueryParameters', () => {
  it('파라미터가 없으면 통과한다', () => {
    expect(() => {
      assertNoQueryParameters({});
    }).not.toThrow();
  });

  it('어떤 파라미터든 거부한다', () => {
    // 스펙 8.2: to-one 관계 URL은 모든 조회 파라미터를 거부한다.
    const error = caught(() => {
      assertNoQueryParameters({ include: 'category' });
    });
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'include' });
  });
});
