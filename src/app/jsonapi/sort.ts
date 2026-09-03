import type { QueryPolicy, SortDirection } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `sort` 질의 파라미터 해석.
 *
 * 결과에는 언제나 정책의 tie breaker가 마지막에 붙는다. 전순서가 아니면 같은 페이지를
 * 두 번 요청했을 때 순서가 달라지고, keyset 커서는 그 위에서 행을 건너뛰거나 겹치게 낸다.
 */

/** 정책을 거쳐 프로퍼티까지 해석한 정렬 항목. */
export interface ResolvedSort {
  /** 공개 이름. 오류 메시지와 커서 서명에 쓴다. */
  readonly field: string;
  /** 엔티티 프로퍼티 이름. SQL에 들어가는 값이다. */
  readonly property: string;
  readonly direction: SortDirection;
  /** NULL을 허용하는 컬럼인가. keyset 커서가 이 표시를 보고 거부한다. */
  readonly nullable: boolean;
}

function invalidSort(detail: string): JsonApiError {
  return new JsonApiError('INVALID_SORT', { source: { parameter: 'sort' }, detail });
}

function resolve(field: string, direction: SortDirection, policy: QueryPolicy): ResolvedSort {
  const declared = policy.sorts[field];
  if (declared === undefined) {
    throw invalidSort(`"${field}" is not a sortable field`);
  }
  return { field, property: declared.property, direction, nullable: declared.nullable };
}

/**
 * 요청의 유효 정렬을 만든다.
 *
 * `sort`가 없으면 정책의 기본 정렬을 쓴다. 어느 쪽이든 tie breaker를 덧붙이되,
 * 이미 같은 필드가 있으면 사용자가 고른 방향을 존중해 덧붙이지 않는다.
 */
export function parseSort(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): ResolvedSort[] {
  const raw = query.sort;
  if (raw !== undefined && typeof raw !== 'string') {
    throw invalidSort('the parameter must be given exactly once');
  }

  const terms: ResolvedSort[] = [];
  const seen = new Set<string>();

  if (raw === undefined) {
    for (const term of policy.defaultSort) {
      terms.push(resolve(term.field, term.direction, policy));
      seen.add(term.field);
    }
  } else {
    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      const descending = trimmed.startsWith('-');
      const field = descending ? trimmed.slice(1) : trimmed;
      if (field === '') {
        throw invalidSort('an empty sort field is not allowed');
      }
      if (seen.has(field)) {
        throw invalidSort(`"${field}" is given more than once`);
      }
      seen.add(field);
      terms.push(resolve(field, descending ? 'DESC' : 'ASC', policy));
    }
  }

  if (!seen.has(policy.tieBreaker.field)) {
    terms.push(resolve(policy.tieBreaker.field, policy.tieBreaker.direction, policy));
  }

  return terms;
}

/**
 * 정렬을 문자열 하나로 요약한다.
 *
 * keyset 커서가 이 값을 담는다. 정렬을 바꾼 뒤 예전 커서를 재사용하면 서명이 어긋나고
 * `INVALID_PAGE`로 거부된다 — 그러지 않으면 커서가 다른 정렬 축의 값을 비교하게 되어
 * 결과가 조용히 어긋난다.
 */
export function sortSignature(sort: readonly ResolvedSort[]): string {
  return sort.map((term) => `${term.direction === 'DESC' ? '-' : ''}${term.field}`).join(',');
}
