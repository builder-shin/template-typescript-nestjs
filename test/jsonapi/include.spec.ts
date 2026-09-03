import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { parseInclude } from '../../src/app/jsonapi/include.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {},
  sorts: { id: { property: 'id', nullable: false } },
  includes: ['category', 'tags'],
  defaultSort: [{ field: 'id', direction: 'ASC' }],
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

describe('parseInclude', () => {
  it('include가 없으면 빈 배열이다', () => {
    expect(parseInclude({}, POLICY, DECLARED)).toEqual([]);
  });

  it('빈 문자열은 아무것도 포함하지 않는다는 뜻이다', () => {
    expect(parseInclude({ include: '' }, POLICY, DECLARED)).toEqual([]);
  });

  it('한 경로를 해석한다', () => {
    expect(parseInclude({ include: 'category' }, POLICY, DECLARED)).toEqual(['category']);
  });

  it('쉼표로 나눈 여러 경로를 해석한다', () => {
    expect(parseInclude({ include: 'category,tags' }, POLICY, DECLARED)).toEqual([
      'category',
      'tags',
    ]);
  });

  it('공백을 허용한다', () => {
    expect(parseInclude({ include: ' category , tags ' }, POLICY, DECLARED)).toEqual([
      'category',
      'tags',
    ]);
  });

  it('같은 경로를 두 번 담지 않는다', () => {
    expect(parseInclude({ include: 'category,category' }, POLICY, DECLARED)).toEqual(['category']);
  });
});

describe('parseInclude 거부', () => {
  it('정책에 없는 경로를 INVALID_INCLUDE로 거부한다', () => {
    const error = caught(() => parseInclude({ include: 'secret' }, POLICY, DECLARED));
    expect(error.code).toBe('INVALID_INCLUDE');
    expect(error.source).toEqual({ parameter: 'include' });
  });

  it('정책이 열었어도 시리얼라이저가 선언하지 않았으면 거부한다', () => {
    // 스펙 8.1은 양쪽 모두를 요구한다. 정책만 보고 통과시키면 직렬화 단계에서
    // 터지고, 그 오류는 사용자 입력 오류가 아니라 500으로 나간다.
    expect(caught(() => parseInclude({ include: 'tags' }, POLICY, ['category'])).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('시리얼라이저가 선언했어도 정책이 열지 않았으면 거부한다', () => {
    const narrow: QueryPolicy = { ...POLICY, includes: ['category'] };
    expect(caught(() => parseInclude({ include: 'tags' }, narrow, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('중첩 경로는 허용 목록에 없으므로 거부된다', () => {
    // 이 템플릿의 허용 목록은 평평하다. 점이 든 경로는 목록에 없어 자연히 걸린다 —
    // 점을 특별히 다루는 규칙을 따로 두지 않는다.
    expect(caught(() => parseInclude({ include: 'category.parent' }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('빈 항목을 거부한다', () => {
    expect(caught(() => parseInclude({ include: 'category,' }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('include가 두 번 오면 거부한다', () => {
    expect(
      caught(() => parseInclude({ include: ['category', 'tags'] }, POLICY, DECLARED)).code,
    ).toBe('INVALID_INCLUDE');
  });
});
