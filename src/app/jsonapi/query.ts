import type { QueryPolicy } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';
import { isFilterKey, parseFilters } from './filter.js';
import type { FilterCondition } from './filter.js';
import { parseInclude } from './include.js';
import { isPageKey, parsePage } from './pagination.js';
import type { PageRequest } from './pagination.js';
import { parseSort } from './sort.js';
import type { ResolvedSort } from './sort.js';

/**
 * 조회 질의 전체 검증과 조립.
 *
 * 알 수 없는 파라미터를 **먼저** 거부한다. 오타 난 파라미터가 조용히 무시되는 것이 이
 * 계층에서 가장 흔한 사고이고, 그 사실을 먼저 말해 주는 편이 값 오류보다 진단에 낫다.
 */

/** 해석을 마친 조회 질의. */
export interface ParsedQuery {
  readonly filters: readonly FilterCondition[];
  readonly sort: readonly ResolvedSort[];
  readonly include: readonly string[];
  readonly page: PageRequest;
}

function invalidParameter(parameter: string, detail: string): JsonApiError {
  return new JsonApiError('INVALID_QUERY_PARAMETER', { source: { parameter }, detail });
}

function assertKnownKeys(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): void {
  for (const key of Object.keys(query)) {
    if (key === 'sort' || key === 'include' || isFilterKey(key) || isPageKey(key)) {
      continue;
    }
    if (key.startsWith('fields[')) {
      // 희소 필드셋은 스펙 1.1의 비목표다. 조용히 무시하면 클라이언트는 적용됐다고 읽는다.
      throw invalidParameter(key, 'sparse fieldsets are not supported');
    }
    throw invalidParameter(key, 'the query parameter is not supported');
  }
}

/** 컬렉션 조회 질의를 해석한다. */
export function parseQuery(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
  declaredRelationships: readonly string[],
): ParsedQuery {
  assertKnownKeys(query);

  return {
    filters: parseFilters(query, policy),
    sort: parseSort(query, policy),
    include: parseInclude(query, policy, declaredRelationships),
    page: parsePage(query, policy),
  };
}

/**
 * to-many 관계 URL(`GET /{id}/{rel}`)의 질의를 해석한다.
 *
 * 스펙 8.2: `page[number]`/`page[size]`만 지원하고 `filter`·`sort`·`include`는 받지
 * 않는다. 총 개수는 언제나 낸다 — 관계 컬렉션은 대체로 작고, 클라이언트가 개수를 알아야
 * 관계 편집 화면을 그릴 수 있다.
 */
export function parseRelatedCollectionQuery(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): PageRequest {
  for (const key of Object.keys(query)) {
    if (key === 'page[number]' || key === 'page[size]') {
      continue;
    }
    throw invalidParameter(key, 'a related collection only supports page[number] and page[size]');
  }

  const page = parsePage(query, policy);
  return { ...page, totals: true };
}

/**
 * to-one 관계 URL(`GET /{id}/{rel}`)에는 조회 파라미터를 허용하지 않는다.
 *
 * 스펙 8.2. 자원 하나를 가리키는 경로에서 filter나 page는 뜻이 없고, 받아 주면
 * 클라이언트가 뜻이 있다고 오해한다.
 */
export function assertNoQueryParameters(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): void {
  for (const key of Object.keys(query)) {
    throw invalidParameter(key, 'this endpoint does not accept query parameters');
  }
}
