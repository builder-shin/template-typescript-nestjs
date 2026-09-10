import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { parseSort, sortSignature } from '../../src/app/jsonapi/sort.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {},
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
    // 공개 이름과 저장 프로퍼티를 일부러 다르게 둔다. 네 필드가 모두 같은 이름이면
    // 구현이 `property: field`로 퇴행해도 테스트가 통과해 버린다.
    name: { property: 'title', nullable: false },
    publishedAt: { property: 'publishedAt', nullable: true },
    id: { property: 'id', nullable: false },
  },
  includes: [],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

// tie breaker가 공개 sorts 표에 없는 정책. EXAMPLE_QUERY_POLICY가 이 모양이다 —
// id는 tie breaker 전용이고 공개 정렬로는 받지 않는다.
const POLICY_WITH_UNDECLARED_TIE_BREAKER: QueryPolicy = {
  filters: {},
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
  },
  includes: [],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

// tie breaker가 공개 sorts 표에 있는 정책. field('rowId')와 property('id')를 일부러
// 다르게 둔다 — 위 POLICY처럼 둘 다 'id'면 `resolveTieBreaker`가 declared.property
// 대신 `property: field`로 퇴행해도 스위트가 통과해 버린다.
const POLICY_WITH_DECLARED_TIE_BREAKER: QueryPolicy = {
  filters: {},
  sorts: { rowId: { property: 'id', nullable: false } },
  includes: [],
  defaultSort: [],
  tieBreaker: { field: 'rowId', direction: 'ASC' },
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
    expect(parseSort({ sort: 'name' }, POLICY)[0]).toEqual({
      field: 'name',
      property: 'title',
      direction: 'ASC',
      nullable: false,
    });
  });

  it('앞의 빼기표는 내림차순이다', () => {
    expect(parseSort({ sort: '-name' }, POLICY)[0]?.direction).toBe('DESC');
  });

  it('여러 필드를 순서대로 해석한다', () => {
    expect(parseSort({ sort: '-createdAt,name' }, POLICY).map((term) => term.field)).toEqual([
      'createdAt',
      'name',
      'id',
    ]);
  });

  it('공개 이름이 아니라 정책의 property를 실어 준다', () => {
    // 사용자 입력이 열 이름이 되는 경로를 막는 계약이다. 공개 이름과 property가
    // 다른 필드로 확인해야 이 계약이 실제로 고정된다.
    const term = parseSort({ sort: 'name' }, POLICY)[0];
    expect(term?.field).toBe('name');
    expect(term?.property).toBe('title');
  });

  it('nullable 표시를 정책에서 가져온다', () => {
    expect(parseSort({ sort: 'publishedAt' }, POLICY)[0]?.nullable).toBe(true);
  });

  it('tie breaker를 언제나 마지막에 붙인다', () => {
    // 전순서가 아니면 같은 페이지를 두 번 요청했을 때 순서가 달라진다.
    const terms = parseSort({ sort: 'name' }, POLICY);
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
    expect(parseSort({ sort: ' -createdAt , name ' }, POLICY).map((term) => term.field)).toEqual([
      'createdAt',
      'name',
      'id',
    ]);
  });
});

describe('parseSort — tie breaker가 공개 sorts 표에 없을 때', () => {
  it('자동으로 붙는 tie breaker는 공개 이름을 프로퍼티로 그대로 쓴다', () => {
    const terms = parseSort({}, POLICY_WITH_UNDECLARED_TIE_BREAKER);
    expect(terms[terms.length - 1]).toEqual({
      field: 'id',
      property: 'id',
      direction: 'ASC',
      nullable: false,
    });
  });

  it('사용자가 명시적으로 요청하면 여전히 INVALID_SORT다', () => {
    // tie breaker 전용이라는 것은 자동 부착만 허용하고, 공개 sort 파라미터로는
    // 받지 않는다는 뜻이다.
    expect(caught(() => parseSort({ sort: 'id' }, POLICY_WITH_UNDECLARED_TIE_BREAKER)).code).toBe(
      'INVALID_SORT',
    );
  });
});

describe('parseSort — tie breaker가 공개 sorts 표에 있을 때', () => {
  it('자동으로 붙는 tie breaker는 선언된 property를 쓴다', () => {
    const terms = parseSort({}, POLICY_WITH_DECLARED_TIE_BREAKER);
    expect(terms[terms.length - 1]?.property).toBe('id');
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
    expect(caught(() => parseSort({ sort: 'name,-name' }, POLICY)).code).toBe('INVALID_SORT');
  });

  it('sort가 두 번 오면 거부한다', () => {
    expect(caught(() => parseSort({ sort: ['name', 'createdAt'] }, POLICY)).code).toBe(
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
    expect(sortSignature(parseSort({ sort: 'name' }, POLICY))).not.toBe(
      sortSignature(parseSort({ sort: '-name' }, POLICY)),
    );
  });

  it('같은 정렬이면 서명이 같다', () => {
    expect(sortSignature(parseSort({}, POLICY))).toBe(
      sortSignature(parseSort({ sort: '-createdAt' }, POLICY)),
    );
  });
});
