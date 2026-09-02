import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  buildCursorLinks,
  buildOffsetLinks,
  isPageKey,
  parsePage,
  probeLimit,
  sliceProbe,
} from '../../src/app/jsonapi/pagination.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {},
  sorts: { id: { property: 'id', nullable: false } },
  includes: [],
  defaultSort: [{ field: 'id', direction: 'ASC' }],
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

describe('isPageKey', () => {
  it('page 키를 알아본다', () => {
    expect(isPageKey('page[number]')).toBe(true);
    expect(isPageKey('page[after]')).toBe(true);
  });

  it('알 수 없는 page 키는 page 키가 아니다', () => {
    // query.ts의 allowlist가 이 값을 보고 INVALID_QUERY_PARAMETER로 거부한다.
    expect(isPageKey('page[offset]')).toBe(false);
    expect(isPageKey('page')).toBe(false);
    expect(isPageKey('sort')).toBe(false);
  });
});

describe('parsePage 기본값', () => {
  it('page가 없으면 offset 모드 1페이지다', () => {
    expect(parsePage({}, POLICY)).toEqual({ mode: 'offset', size: 25, number: 1, totals: false });
  });

  it('page[size]를 읽는다', () => {
    expect(parsePage({ 'page[size]': '10' }, POLICY).size).toBe(10);
  });

  it('page[number]를 읽는다', () => {
    expect(parsePage({ 'page[number]': '3' }, POLICY).number).toBe(3);
  });

  it('page[totals]=true를 읽는다', () => {
    expect(parsePage({ 'page[totals]': 'true' }, POLICY).totals).toBe(true);
    expect(parsePage({ 'page[totals]': 'false' }, POLICY).totals).toBe(false);
  });

  it('page[after]가 있으면 cursor 모드다', () => {
    expect(parsePage({ 'page[after]': 'abc' }, POLICY)).toEqual({
      mode: 'cursor',
      size: 25,
      after: 'abc',
      totals: false,
    });
  });

  it('빈 page[after]는 컬렉션 시작을 가리키는 진입점이다', () => {
    const page = parsePage({ 'page[after]': '' }, POLICY);
    expect(page.mode).toBe('cursor');
    expect(page.after).toBe('');
  });

  it('빈 page[before]는 컬렉션 끝을 가리키는 진입점이다', () => {
    const page = parsePage({ 'page[before]': '' }, POLICY);
    expect(page.mode).toBe('cursor');
    expect(page.before).toBe('');
  });

  it('page[size]는 최대치 자체는 받는다', () => {
    // 상한 비교가 `>=`로 잘못 바뀌면 정확히 100인 요청이 거부된다.
    expect(parsePage({ 'page[size]': '100' }, POLICY).size).toBe(100);
  });
});

describe('parsePage 거부', () => {
  it('page[size]가 최대치를 넘으면 거부한다', () => {
    const error = caught(() => parsePage({ 'page[size]': '101' }, POLICY));
    expect(error.code).toBe('INVALID_PAGE');
    expect(error.source).toEqual({ parameter: 'page[size]' });
  });

  it('page[size]가 0 이하면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[size]': '0' }, POLICY)).code).toBe('INVALID_PAGE');
    expect(caught(() => parsePage({ 'page[size]': '-1' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('page[size]가 정수가 아니면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[size]': '2.5' }, POLICY)).code).toBe('INVALID_PAGE');
    expect(caught(() => parsePage({ 'page[size]': 'many' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('page[number]가 1보다 작으면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[number]': '0' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('page[totals]가 참거짓이 아니면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[totals]': '1' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('after와 before를 함께 쓰면 거부한다', () => {
    const error = caught(() => parsePage({ 'page[after]': 'a', 'page[before]': 'b' }, POLICY));
    expect(error.code).toBe('INVALID_PAGE');
  });

  it('커서와 page[number]를 함께 쓰면 거부한다', () => {
    // 두 모드가 섞이면 어느 쪽이 적용됐는지 응답만 보고는 알 수 없다.
    expect(caught(() => parsePage({ 'page[after]': 'a', 'page[number]': '2' }, POLICY)).code).toBe(
      'INVALID_PAGE',
    );
  });

  it('같은 page 파라미터가 두 번 오면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[size]': ['1', '2'] }, POLICY)).code).toBe('INVALID_PAGE');
  });
});

describe('probeLimit / sliceProbe', () => {
  it('요청 크기보다 한 행 더 읽는다', () => {
    // COUNT를 돌리지 않고 다음 페이지 존재를 판정하는 방법이다(스펙 8.2).
    expect(probeLimit(parsePage({ 'page[size]': '10' }, POLICY))).toBe(11);
  });

  it('한 행이 더 왔으면 hasMore가 참이고 그 행은 버린다', () => {
    const page = parsePage({ 'page[size]': '2' }, POLICY);
    expect(sliceProbe(['a', 'b', 'c'], page)).toEqual({ items: ['a', 'b'], hasMore: true });
  });

  it('꽉 차지 않았으면 hasMore가 거짓이다', () => {
    const page = parsePage({ 'page[size]': '2' }, POLICY);
    expect(sliceProbe(['a'], page)).toEqual({ items: ['a'], hasMore: false });
  });

  it('정확히 크기만큼 왔으면 hasMore가 거짓이다', () => {
    const page = parsePage({ 'page[size]': '2' }, POLICY);
    expect(sliceProbe(['a', 'b'], page)).toEqual({ items: ['a', 'b'], hasMore: false });
  });
});

describe('buildOffsetLinks', () => {
  const base = '/api/v1/examples';

  it('self와 first를 낸다', () => {
    const page = parsePage({}, POLICY);
    const links = buildOffsetLinks(base, {}, page, false, undefined);
    expect(links.self).toBe('/api/v1/examples?page[number]=1&page[size]=25');
    expect(links.first).toBe('/api/v1/examples?page[number]=1&page[size]=25');
  });

  it('첫 페이지에는 prev가 없다', () => {
    const links = buildOffsetLinks(base, {}, parsePage({}, POLICY), false, undefined);
    expect(links.prev).toBeUndefined();
  });

  it('다음 페이지가 없으면 next가 없다', () => {
    const links = buildOffsetLinks(base, {}, parsePage({}, POLICY), false, undefined);
    expect(links.next).toBeUndefined();
  });

  it('다음 페이지가 있으면 next를 낸다', () => {
    const query = { 'page[number]': '2', 'page[size]': '5' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), true, undefined);
    expect(links.next).toBe('/api/v1/examples?page[number]=3&page[size]=5');
    expect(links.prev).toBe('/api/v1/examples?page[number]=1&page[size]=5');
  });

  it('totals를 요청하지 않으면 last가 없다', () => {
    // COUNT를 돌리지 않았으므로 마지막 페이지 번호를 알 수 없다.
    const links = buildOffsetLinks(base, {}, parsePage({}, POLICY), true, undefined);
    expect(links.last).toBeUndefined();
  });

  it('totals를 요청하면 last를 내고 모든 링크가 totals를 유지한다', () => {
    const query = { 'page[size]': '10', 'page[totals]': 'true', 'page[number]': '2' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), true, 35);
    expect(links.last).toBe('/api/v1/examples?page[number]=4&page[size]=10&page[totals]=true');
    expect(links.self).toContain('page[totals]=true');
    expect(links.first).toContain('page[totals]=true');
    expect(links.prev).toContain('page[totals]=true');
    expect(links.next).toContain('page[totals]=true');
  });

  it('총 개수가 0이면 last는 1페이지다', () => {
    const query = { 'page[totals]': 'true' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), false, 0);
    expect(links.last).toBe('/api/v1/examples?page[number]=1&page[size]=25&page[totals]=true');
  });

  it('filter와 sort를 링크에 그대로 실어 나른다', () => {
    // 링크를 따라간 결과가 원래 요청과 다른 집합이면 페이지네이션이 깨진 것이다.
    const query = { 'filter[status]': 'draft', sort: '-createdAt' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), true, undefined);
    expect(links.next).toContain('filter[status]=draft');
    expect(links.next).toContain('sort=-createdAt');
  });

  it('값을 URL 인코딩한다', () => {
    const query = { 'filter[title]': '가 나' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), false, undefined);
    expect(links.self).toContain('filter[title]=%EA%B0%80%20%EB%82%98');
  });

  it('같은 파라미터가 두 번 온 값을 링크에 모두 실어 나른다', () => {
    // Node는 중복 키를 배열로 준다. 링크가 그중 하나를 잃으면 링크를 따라간 결과가
    // 원래 읽던 페이지와 다른 집합이 된다.
    const query = { 'filter[status][in]': ['draft', 'published'] };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), true, undefined);
    expect(links.self).toContain('filter[status][in]=draft');
    expect(links.self).toContain('filter[status][in]=published');
    expect(links.next).toContain('filter[status][in]=draft');
    expect(links.next).toContain('filter[status][in]=published');
  });
});

describe('buildCursorLinks', () => {
  const base = '/api/v1/examples';

  it('first와 last를 빈 진입점으로 낸다', () => {
    const query = { 'page[after]': '' };
    const links = buildCursorLinks(
      base,
      query,
      parsePage(query, POLICY),
      undefined,
      undefined,
      false,
    );
    expect(links.first).toBe('/api/v1/examples?page[after]=&page[size]=25');
    expect(links.last).toBe('/api/v1/examples?page[before]=&page[size]=25');
  });

  it('다음 페이지가 있으면 마지막 행의 커서로 next를 낸다', () => {
    const query = { 'page[after]': '' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), 'AAA', 'ZZZ', true);
    expect(links.next).toBe('/api/v1/examples?page[after]=ZZZ&page[size]=25');
    expect(links.prev).toBe('/api/v1/examples?page[before]=AAA&page[size]=25');
  });

  it('다음 페이지가 없으면 next를 내지 않는다', () => {
    const query = { 'page[after]': '' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), 'AAA', 'ZZZ', false);
    expect(links.next).toBeUndefined();
  });

  it('페이지가 비면 prev도 next도 없다', () => {
    const query = { 'page[after]': 'X' };
    const links = buildCursorLinks(
      base,
      query,
      parsePage(query, POLICY),
      undefined,
      undefined,
      false,
    );
    expect(links.prev).toBeUndefined();
    expect(links.next).toBeUndefined();
  });

  it('filter를 링크에 실어 나른다', () => {
    const query = { 'page[after]': '', 'filter[status]': 'draft' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), undefined, 'Z', true);
    expect(links.next).toContain('filter[status]=draft');
  });

  it('totals를 요청하면 모든 커서 링크가 그 값을 유지한다', () => {
    const query = { 'page[after]': '', 'page[totals]': 'true' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), 'AAA', 'ZZZ', true);
    expect(links.self).toContain('page[totals]=true');
    expect(links.first).toContain('page[totals]=true');
    expect(links.last).toContain('page[totals]=true');
    expect(links.prev).toContain('page[totals]=true');
    expect(links.next).toContain('page[totals]=true');
  });

  it('page[before]로 들어온 요청의 self는 before를 그대로 쓴다', () => {
    const query = { 'page[before]': 'ZZZ' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), 'AAA', 'BBB', true);
    expect(links.self).toBe('/api/v1/examples?page[before]=ZZZ&page[size]=25');
  });
});
