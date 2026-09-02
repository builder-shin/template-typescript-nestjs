import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { parseSort, sortSignature } from '../../src/app/jsonapi/sort.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {},
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
    title: { property: 'title', nullable: false },
    publishedAt: { property: 'publishedAt', nullable: true },
    id: { property: 'id', nullable: false },
  },
  includes: [],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

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

describe('parseSort', () => {
  it('sort가 없으면 기본 정렬에 tie breaker를 붙인다', () => {
    expect(parseSort({}, POLICY)).toEqual([
      { field: 'createdAt', property: 'createdAt', direction: 'DESC', nullable: false },
      { field: 'id', property: 'id', direction: 'ASC', nullable: false },
    ]);
  });

  it('오름차순 필드를 해석한다', () => {
    expect(parseSort({ sort: 'title' }, POLICY)[0]).toEqual({
      field: 'title',
      property: 'title',
      direction: 'ASC',
      nullable: false,
    });
  });

  it('앞의 빼기표는 내림차순이다', () => {
    expect(parseSort({ sort: '-title' }, POLICY)[0]?.direction).toBe('DESC');
  });

  it('여러 필드를 순서대로 해석한다', () => {
    expect(parseSort({ sort: '-createdAt,title' }, POLICY).map((term) => term.field)).toEqual([
      'createdAt',
      'title',
      'id',
    ]);
  });

  it('공개 이름이 아니라 정책의 property를 실어 준다', () => {
    expect(parseSort({ sort: 'title' }, POLICY)[0]?.property).toBe('title');
  });

  it('nullable 표시를 정책에서 가져온다', () => {
    expect(parseSort({ sort: 'publishedAt' }, POLICY)[0]?.nullable).toBe(true);
  });

  it('tie breaker를 언제나 마지막에 붙인다', () => {
    // 전순서가 아니면 같은 페이지를 두 번 요청했을 때 순서가 달라진다.
    const terms = parseSort({ sort: 'title' }, POLICY);
    expect(terms[terms.length - 1]).toEqual({
      field: 'id',
      property: 'id',
      direction: 'ASC',
      nullable: false,
    });
  });

  it('이미 tie breaker 필드를 담고 있으면 덧붙이지 않는다', () => {
    const terms = parseSort({ sort: '-id' }, POLICY);
    expect(terms).toHaveLength(1);
    expect(terms[0]?.direction).toBe('DESC');
  });

  it('공백을 허용한다', () => {
    expect(parseSort({ sort: ' -createdAt , title ' }, POLICY).map((term) => term.field)).toEqual([
      'createdAt',
      'title',
      'id',
    ]);
  });
});

describe('parseSort 거부', () => {
  it('선언되지 않은 필드를 INVALID_SORT로 거부한다', () => {
    const error = caught(() => parseSort({ sort: 'secret' }, POLICY));
    expect(error.code).toBe('INVALID_SORT');
    expect(error.source).toEqual({ parameter: 'sort' });
  });

  it('빈 sort를 거부한다', () => {
    expect(caught(() => parseSort({ sort: '' }, POLICY)).code).toBe('INVALID_SORT');
    expect(caught(() => parseSort({ sort: ',' }, POLICY)).code).toBe('INVALID_SORT');
  });

  it('빼기표만 있는 항목을 거부한다', () => {
    expect(caught(() => parseSort({ sort: '-' }, POLICY)).code).toBe('INVALID_SORT');
  });

  it('같은 필드를 두 번 쓰면 거부한다', () => {
    // 뒤 항목은 절대 적용되지 않는데 사용자는 적용됐다고 읽는다.
    expect(caught(() => parseSort({ sort: 'title,-title' }, POLICY)).code).toBe('INVALID_SORT');
  });

  it('sort가 두 번 오면 거부한다', () => {
    expect(caught(() => parseSort({ sort: ['title', 'createdAt'] }, POLICY)).code).toBe(
      'INVALID_SORT',
    );
  });
});

describe('sortSignature', () => {
  it('필드와 방향을 순서대로 담는다', () => {
    expect(sortSignature(parseSort({ sort: '-createdAt' }, POLICY))).toBe('-createdAt,id');
  });

  it('정렬이 다르면 서명도 다르다', () => {
    // 커서는 이 서명에 묶인다. 정렬이 바뀐 뒤 커서를 재사용하면 거부해야 한다.
    expect(sortSignature(parseSort({ sort: 'title' }, POLICY))).not.toBe(
      sortSignature(parseSort({ sort: '-title' }, POLICY)),
    );
  });

  it('같은 정렬이면 서명이 같다', () => {
    expect(sortSignature(parseSort({}, POLICY))).toBe(
      sortSignature(parseSort({ sort: '-createdAt' }, POLICY)),
    );
  });
});
