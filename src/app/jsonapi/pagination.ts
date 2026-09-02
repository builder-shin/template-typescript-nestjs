import { MAX_PAGE_SIZE } from '../schemas/query-policy.js';
import type { QueryPolicy } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `page[...]` 파라미터 해석과 링크 조립.
 *
 * 목록 응답은 COUNT를 기본 실행하지 않는다. 요청 크기보다 한 행 더 읽어(probe) 다음
 * 페이지가 있는지 판정하고, 그 한 행은 응답에서 버린다. COUNT는 큰 테이블에서 목록
 * 조회보다 비싸질 수 있어서, 필요하다고 말한 요청(`page[totals]=true`)에만 돌린다.
 */

/** 페이지네이션 모드. */
export type PageMode = 'offset' | 'cursor';

/** 해석을 마친 페이지 요청. */
export interface PageRequest {
  readonly mode: PageMode;
  readonly size: number;
  /** offset 모드의 1-기반 페이지 번호. */
  readonly number?: number;
  /** cursor 모드의 진입점. 빈 문자열은 컬렉션의 시작을 가리킨다. */
  readonly after?: string;
  /** cursor 모드의 진입점. 빈 문자열은 컬렉션의 끝을 가리킨다. */
  readonly before?: string;
  readonly totals: boolean;
}

/** 페이지 링크. 낼 수 없는 링크는 멤버째 생략한다. */
export interface PaginationLinks {
  readonly self: string;
  readonly first?: string;
  readonly prev?: string;
  readonly next?: string;
  readonly last?: string;
}

/** probe로 한 행 더 읽은 결과를 자른 것. */
export interface ProbeResult<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}

/** 이 저장소가 아는 page 파라미터. 목록에 없는 `page[...]`는 알 수 없는 파라미터다. */
export const PAGE_KEYS: readonly string[] = [
  'page[number]',
  'page[size]',
  'page[after]',
  'page[before]',
  'page[totals]',
];

/** 이 키가 알려진 page 파라미터인지 본다. */
export function isPageKey(key: string): boolean {
  return PAGE_KEYS.includes(key);
}

const INTEGER_PATTERN = /^-?\d+$/;

function invalidPage(parameter: string, detail: string): JsonApiError {
  return new JsonApiError('INVALID_PAGE', { source: { parameter }, detail });
}

function single(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  key: string,
): string | undefined {
  const raw = query[key];
  if (raw === undefined || typeof raw === 'string') {
    return raw;
  }
  throw invalidPage(key, 'the parameter must be given exactly once');
}

function integer(raw: string, key: string): number {
  if (!INTEGER_PATTERN.test(raw)) {
    throw invalidPage(key, 'expected an integer');
  }
  return Number.parseInt(raw, 10);
}

/** 질의 파라미터에서 페이지 요청을 만든다. */
export function parsePage(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): PageRequest {
  const rawSize = single(query, 'page[size]');
  const rawNumber = single(query, 'page[number]');
  const rawTotals = single(query, 'page[totals]');
  const after = single(query, 'page[after]');
  const before = single(query, 'page[before]');

  let size = policy.defaultPageSize;
  if (rawSize !== undefined) {
    size = integer(rawSize, 'page[size]');
    if (size < 1) {
      throw invalidPage('page[size]', 'the page size must be at least 1');
    }
    if (size > MAX_PAGE_SIZE) {
      throw invalidPage('page[size]', `the page size must be at most ${String(MAX_PAGE_SIZE)}`);
    }
  }

  let totals = false;
  if (rawTotals !== undefined) {
    if (rawTotals !== 'true' && rawTotals !== 'false') {
      throw invalidPage('page[totals]', 'expected "true" or "false"');
    }
    totals = rawTotals === 'true';
  }

  if (after !== undefined && before !== undefined) {
    throw invalidPage('page[after]', 'page[after] and page[before] cannot be combined');
  }

  const cursor = after ?? before;
  if (cursor !== undefined) {
    // 두 모드가 섞이면 어느 쪽이 적용됐는지 응답만 보고는 알 수 없다.
    if (rawNumber !== undefined) {
      throw invalidPage('page[number]', 'a cursor cannot be combined with page[number]');
    }
    return {
      mode: 'cursor',
      size,
      totals,
      ...(after === undefined ? { before } : { after }),
    };
  }

  let number = 1;
  if (rawNumber !== undefined) {
    number = integer(rawNumber, 'page[number]');
    if (number < 1) {
      throw invalidPage('page[number]', 'the page number must be at least 1');
    }
  }

  return { mode: 'offset', size, number, totals };
}

/** 실제로 읽을 행 수. 다음 페이지 판정을 위해 한 행을 더 읽는다. */
export function probeLimit(page: PageRequest): number {
  return page.size + 1;
}

/** probe로 읽은 행을 요청 크기만큼 자르고 다음 페이지 존재를 판정한다. */
export function sliceProbe<T>(rows: readonly T[], page: PageRequest): ProbeResult<T> {
  if (rows.length > page.size) {
    return { items: rows.slice(0, page.size), hasMore: true };
  }
  return { items: rows, hasMore: false };
}

/**
 * 질의 키를 인코딩하되 대괄호는 남긴다.
 *
 * `filter[title]`이 `filter%5Btitle%5D`로 나가도 서버는 읽지만, JSON:API 규격의 예시와
 * 실제로 오가는 링크가 눈으로 대조되지 않는다. 대괄호는 사실상 모든 클라이언트가
 * 그대로 받아들인다.
 */
function encodeKey(key: string): string {
  return encodeURIComponent(key).replace(/%5B/g, '[').replace(/%5D/g, ']');
}

function toQueryString(pairs: readonly (readonly [string, string])[]): string {
  return pairs.map(([key, value]) => `${encodeKey(key)}=${encodeURIComponent(value)}`).join('&');
}

/** page 파라미터를 뺀 나머지를 원래 모습 그대로 모은다. */
function preservedPairs(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('page[') || value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      pairs.push([key, value]);
      continue;
    }
    for (const entry of value) {
      pairs.push([key, entry]);
    }
  }
  return pairs;
}

/**
 * offset 모드의 페이지 링크를 만든다.
 *
 * `page[totals]=true`를 보낸 요청은 모든 링크가 그 값을 유지한다 — 링크를 따라갔을 때
 * `meta.totalCount`가 사라지면 클라이언트가 페이지 수를 잃는다.
 *
 * `last`는 총 개수를 아는 요청에만 낸다. COUNT를 돌리지 않았으면 마지막 페이지 번호를
 * 알 방법이 없고, 모르면서 지어내는 링크는 없는 것만 못하다.
 */
export function buildOffsetLinks(
  basePath: string,
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  page: PageRequest,
  hasMore: boolean,
  totalCount: number | undefined,
): PaginationLinks {
  const preserved = preservedPairs(query);
  const current = page.number ?? 1;

  const link = (pageNumber: number): string => {
    const pairs: (readonly [string, string])[] = [
      ...preserved,
      ['page[number]', String(pageNumber)],
      ['page[size]', String(page.size)],
      ...(page.totals ? [['page[totals]', 'true'] as const] : []),
    ];
    return `${basePath}?${toQueryString(pairs)}`;
  };

  const links: {
    self: string;
    first?: string;
    prev?: string;
    next?: string;
    last?: string;
  } = { self: link(current), first: link(1) };

  if (current > 1) {
    links.prev = link(current - 1);
  }
  if (hasMore) {
    links.next = link(current + 1);
  }
  if (page.totals && totalCount !== undefined) {
    links.last = link(Math.max(1, Math.ceil(totalCount / page.size)));
  }

  return links;
}

/**
 * cursor 모드의 페이지 링크를 만든다.
 *
 * offset 모드와 달리 `first`와 `last`를 빈 진입점으로 낸다 — `page[after]=`는 컬렉션의
 * 시작, `page[before]=`는 끝을 가리킨다. 총 개수를 모르고도 양 끝으로 갈 수 있다.
 *
 * `prev`/`next`는 이번 페이지의 첫 행과 마지막 행에서 만든 커서다. 페이지가 비었으면
 * 만들 커서가 없으므로 둘 다 내지 않는다.
 */
export function buildCursorLinks(
  basePath: string,
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  page: PageRequest,
  firstCursor: string | undefined,
  lastCursor: string | undefined,
  hasMore: boolean,
): PaginationLinks {
  const preserved = preservedPairs(query);

  const link = (pageParams: readonly (readonly [string, string])[]): string => {
    const pairs: (readonly [string, string])[] = [
      ...preserved,
      ...pageParams,
      ['page[size]', String(page.size)],
      ...(page.totals ? [['page[totals]', 'true'] as const] : []),
    ];
    return `${basePath}?${toQueryString(pairs)}`;
  };

  const selfParams: (readonly [string, string])[] =
    page.after !== undefined
      ? [['page[after]', page.after]]
      : [['page[before]', page.before ?? '']];

  const links: {
    self: string;
    first?: string;
    prev?: string;
    next?: string;
    last?: string;
  } = {
    self: link(selfParams),
    first: link([['page[after]', '']]),
    last: link([['page[before]', '']]),
  };

  if (firstCursor !== undefined) {
    links.prev = link([['page[before]', firstCursor]]);
  }
  if (hasMore && lastCursor !== undefined) {
    links.next = link([['page[after]', lastCursor]]);
  }

  return links;
}
