import { JsonApiError } from './errors.js';
import type { ResolvedSort } from './sort.js';

/**
 * keyset(cursor) 페이지네이션의 커서.
 *
 * 커서는 "마지막으로 본 행의 정렬 키 값"이다. OFFSET과 달리 앞쪽 행이 지워지거나
 * 끼어들어도 같은 지점을 가리키므로, 큰 컬렉션을 훑는 동안 행을 건너뛰거나 두 번 보는
 * 일이 없다.
 *
 * 커서는 **그 커서를 만든 정렬에 묶인다**. 정렬을 바꾼 뒤 예전 커서를 쓰면 다른 축의
 * 값을 비교하게 되어 결과가 조용히 어긋나므로, 서명이 다르면 거부한다.
 */

interface CursorPayload {
  readonly sort: string;
  readonly values: readonly string[];
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function invalidCursor(detail: string): JsonApiError {
  // `source`는 언제나 `page[after]`로 둔다. `before`로 온 커서도 같은 규칙을 어긴
  // 것이고, 두 파라미터를 갈라 적으면 오류 문구만 늘고 진단은 나아지지 않는다.
  return new JsonApiError('INVALID_PAGE', { source: { parameter: 'page[after]' }, detail });
}

/** 정렬 서명과 값으로 커서를 만든다. */
export function encodeCursor(signature: string, values: readonly string[]): string {
  const payload: CursorPayload = { sort: signature, values };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function readPayload(raw: string): CursorPayload {
  if (raw === '' || !BASE64URL_PATTERN.test(raw)) {
    throw invalidCursor('the cursor is malformed');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor('the cursor is malformed');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('sort' in parsed) ||
    !('values' in parsed)
  ) {
    throw invalidCursor('the cursor is malformed');
  }
  const sort = parsed.sort;
  const values = parsed.values;
  if (typeof sort !== 'string' || !Array.isArray(values)) {
    throw invalidCursor('the cursor is malformed');
  }
  const entries: unknown[] = values;
  if (!entries.every((entry) => typeof entry === 'string')) {
    throw invalidCursor('the cursor is malformed');
  }
  // `every`가 좁혀 주지 않으므로 한 번 더 걸러 문자열 배열을 만든다.
  const strings = entries.filter((entry): entry is string => typeof entry === 'string');
  return { sort, values: strings };
}

/**
 * 커서를 해석하고 이번 요청의 정렬과 맞는지 확인한다.
 *
 * 서명이 다르거나 항목 수가 다르면 `INVALID_PAGE`다.
 */
export function decodeCursor(
  raw: string,
  expectedSignature: string,
  expectedLength: number,
): readonly string[] {
  const payload = readPayload(raw);
  if (payload.sort !== expectedSignature) {
    throw invalidCursor('the cursor was issued for a different sort order');
  }
  if (payload.values.length !== expectedLength) {
    throw invalidCursor('the cursor does not match the current sort order');
  }
  return payload.values;
}

/**
 * 이 정렬로 keyset 커서를 쓸 수 있는지 확인한다.
 *
 * NULL을 허용하는 컬럼이 섞이면 `컬럼 > 값` 비교가 NULL 행에서 unknown이 되어 그 행이
 * 조용히 빠진다. 조용히 빠지느니 거부한다(스펙 8.2).
 */
export function assertCursorSortable(sort: readonly ResolvedSort[]): void {
  for (const term of sort) {
    if (term.nullable) {
      throw invalidCursor(
        `cursor pagination cannot be used with the nullable sort "${term.field}"`,
      );
    }
  }
}

/** keyset 비교식과 그 파라미터. */
export interface KeysetPredicate {
  readonly clause: string;
  readonly parameters: Record<string, string>;
}

/**
 * 사전식 keyset 비교식을 만든다.
 *
 * 행 값 비교(`(a, b) > (x, y)`)는 모든 컬럼의 정렬 방향이 같을 때만 맞다. 이 템플릿은
 * 방향이 섞인 정렬을 허용하므로 사전식으로 펼친다.
 *
 * 컬럼 이름은 `ResolvedSort.property`에서만 나온다 — 그 값은 정책 allowlist를 거친
 * 것이므로 사용자 입력이 열 이름이 되는 경로가 없다.
 */
export function keysetPredicate(
  alias: string,
  sort: readonly ResolvedSort[],
  values: readonly string[],
  direction: 'after' | 'before',
): KeysetPredicate {
  const parameters: Record<string, string> = {};
  values.forEach((value, index) => {
    parameters[`cursor${String(index)}`] = value;
  });

  const branches: string[] = [];
  sort.forEach((term, index) => {
    const ascending = term.direction === 'ASC';
    const forward = direction === 'after' ? ascending : !ascending;
    const comparison = forward ? '>' : '<';

    // 앞선 항목들이 모두 같을 때만 이 항목의 부등호를 본다. 이것이 사전식 비교다.
    const equalities = sort
      .slice(0, index)
      .map((earlier, previous) => `${alias}.${earlier.property} = :cursor${String(previous)}`);
    equalities.push(`${alias}.${term.property} ${comparison} :cursor${String(index)}`);
    branches.push(`(${equalities.join(' AND ')})`);
  });

  return { clause: `(${branches.join(' OR ')})`, parameters };
}
