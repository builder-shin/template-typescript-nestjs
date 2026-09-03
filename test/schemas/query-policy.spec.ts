import {
  FILTER_OPERATORS,
  MAX_PAGE_SIZE,
  isFilterOperator,
} from '../../src/app/schemas/query-policy.js';

describe('FILTER_OPERATORS', () => {
  it('스펙 8.1이 정한 여덟 연산자를 담는다', () => {
    expect([...FILTER_OPERATORS].sort()).toEqual([
      'contains',
      'exact',
      'gt',
      'gte',
      'in',
      'isNull',
      'lt',
      'lte',
    ]);
  });
});

describe('isFilterOperator', () => {
  it('카탈로그에 있는 이름을 받는다', () => {
    expect(isFilterOperator('exact')).toBe(true);
    expect(isFilterOperator('isNull')).toBe(true);
  });

  it('없는 이름을 거부한다', () => {
    expect(isFilterOperator('like')).toBe(false);
    expect(isFilterOperator('')).toBe(false);
    expect(isFilterOperator('EXACT')).toBe(false);
  });
});

describe('MAX_PAGE_SIZE', () => {
  it('스펙 8.2가 정한 100이다', () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });
});
