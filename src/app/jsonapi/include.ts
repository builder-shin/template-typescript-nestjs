import type { QueryPolicy } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `include` 질의 파라미터 해석.
 *
 * 스펙 8.1: 경로는 시리얼라이저의 관계 선언과 `QueryPolicy.includes` **양쪽**에서
 * 허용되어야 한다. 한쪽만 보고 통과시키면 두 선언이 갈라졌을 때 조용히 어긋난다 —
 * 정책에만 있으면 직렬화할 방법이 없어 500이 되고, 시리얼라이저에만 있으면 정책이
 * 열지 않기로 한 것을 뚫는다.
 *
 * 허용 목록은 평평하다. `category.parent` 같은 중첩 경로는 목록에 없으므로 자연히
 * 걸린다 — 점을 특별히 다루는 규칙을 따로 두지 않는다.
 */
function invalidInclude(): JsonApiError {
  return new JsonApiError('INVALID_INCLUDE', { source: { parameter: 'include' } });
}

/** 요청이 요구한 include 경로를 정책과 시리얼라이저에 대조해 돌려준다. */
export function parseInclude(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
  declaredRelationships: readonly string[],
): string[] {
  const raw = query.include;
  if (raw === undefined) {
    return [];
  }
  if (typeof raw !== 'string') {
    throw invalidInclude();
  }
  if (raw.trim() === '') {
    return [];
  }

  const paths: string[] = [];
  for (const entry of raw.split(',')) {
    const path = entry.trim();
    if (path === '') {
      throw invalidInclude();
    }
    if (!policy.includes.includes(path)) {
      throw invalidInclude();
    }
    if (!declaredRelationships.includes(path)) {
      throw invalidInclude();
    }
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }

  return paths;
}
