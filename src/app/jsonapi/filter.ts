import type { FilterFieldPolicy, FilterOperator, QueryPolicy } from '../schemas/query-policy.js';
import { isFilterOperator } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `filter[...]` 질의 파라미터 해석.
 *
 * Express 5의 기본 query parser는 `'simple'`이라 `req.query`가 대괄호를 그대로 가진
 * 평평한 문자열 맵이다(`?filter[a][gt]=1` → `{ 'filter[a][gt]': '1' }`). 중첩 객체를
 * 기대하지 않는 이유가 그것이다.
 *
 * **열 이름은 언제나 정책에서 나온다.** 사용자가 보낸 필드 이름은 정책 표의 키를 찾는
 * 데만 쓰이고, 결과에 담기는 `property`는 표가 들고 있던 값이다.
 *
 * 값 변환은 느슨하게 하지 않는다. `new Date('2026')`처럼 통과해 버리는 파싱은
 * 사용자가 의도한 범위와 실제 범위를 조용히 갈라놓는다.
 */

/** 변환을 마친 스칼라 필터 값. */
export type ScalarFilterValue = string | number | boolean | Date;

/** 변환을 마친 필터 값. `in`은 배열, `isNull`은 참거짓이다. */
export type FilterValue = ScalarFilterValue | readonly ScalarFilterValue[];

/** 컴파일러에 넘길 조건 하나. */
export interface FilterCondition {
  /** 원본 질의 키. 오류의 `source.parameter`에 그대로 쓴다. */
  readonly parameter: string;
  /** 엔티티 프로퍼티 이름. 정책에서 온 값이다. */
  readonly property: string;
  readonly operator: FilterOperator;
  readonly value: FilterValue;
}

/** `filter[<field>]` 또는 `filter[<field>][<operator>]`. */
export const FILTER_KEY_PATTERN = /^filter\[([^[\]]+)\](?:\[([^[\]]+)\])?$/;

/** 이 키가 filter 파라미터인지 본다. */
export function isFilterKey(key: string): boolean {
  return FILTER_KEY_PATTERN.test(key);
}

// 같은 모양을 `controllers/concerns/relationship-resolver.ts`도 따로 갖는다. 그쪽은
// "이 id가 행을 가리킬 수 있는가"를 보고 여기는 "필터 값이 uuid 형식인가"를 봐서
// 이유가 다르므로 합치지 않는다. 한쪽을 고칠 일이 생기면 다른 쪽도 함께 본다.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;
// 날짜와 시각을 모두 요구한다. 오프셋은 `Z` 또는 `±HH:MM`.
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function invalidFilter(parameter: string, detail: string): JsonApiError {
  return new JsonApiError('INVALID_FILTER', { source: { parameter }, detail });
}

function toBoolean(raw: string, parameter: string): boolean {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw invalidFilter(parameter, 'expected "true" or "false"');
}

function toScalar(raw: string, field: FilterFieldPolicy, parameter: string): ScalarFilterValue {
  switch (field.type) {
    case 'string':
      return raw;
    case 'number': {
      if (!NUMBER_PATTERN.test(raw)) {
        throw invalidFilter(parameter, 'expected a number');
      }
      return Number(raw);
    }
    case 'boolean':
      return toBoolean(raw, parameter);
    case 'uuid': {
      if (!UUID_PATTERN.test(raw)) {
        throw invalidFilter(parameter, 'expected a UUID');
      }
      return raw;
    }
    case 'timestamp': {
      if (!TIMESTAMP_PATTERN.test(raw)) {
        throw invalidFilter(parameter, 'expected an ISO 8601 timestamp');
      }
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw invalidFilter(parameter, 'expected a valid ISO 8601 timestamp');
      }
      return parsed;
    }
    case 'enum': {
      const values = field.values ?? [];
      if (!values.includes(raw)) {
        throw invalidFilter(parameter, `expected one of: ${values.join(', ')}`);
      }
      return raw;
    }
  }
}

function readSingle(value: string | readonly string[] | undefined, parameter: string): string {
  if (typeof value === 'string') {
    return value;
  }
  // 같은 키가 두 번 오면 Node가 배열로 준다. 조용히 하나만 쓰면 어느 쪽이 적용됐는지
  // 사용자가 알 수 없다.
  throw invalidFilter(parameter, 'the parameter must be given exactly once');
}

function conditionFor(
  parameter: string,
  fieldName: string,
  operatorName: string,
  raw: string | readonly string[] | undefined,
  policy: QueryPolicy,
): FilterCondition {
  const field = policy.filters[fieldName];
  if (field === undefined) {
    throw invalidFilter(parameter, `"${fieldName}" is not a filterable field`);
  }
  if (!isFilterOperator(operatorName) || !field.operators.includes(operatorName)) {
    throw invalidFilter(parameter, `"${operatorName}" is not allowed on "${fieldName}"`);
  }
  if (operatorName === 'contains' && field.type !== 'string') {
    // 컴파일러는 `contains`를 `ILIKE`로 옮긴다. 텍스트가 아닌 컬럼(enum 포함)에 걸면
    // PostgreSQL이 거절해 500이 된다. 정책 선언이 틀린 것이지 요청이 틀린 것이 아니므로
    // `JsonApiError`가 아니라 `TypeError`다.
    throw new TypeError(
      `"${fieldName}"은 type이 "${field.type}"이라 contains를 선언할 수 없다 — contains는 string 필드에만 쓴다`,
    );
  }

  const value = readSingle(raw, parameter);

  if (operatorName === 'isNull') {
    return {
      parameter,
      property: field.property,
      operator: 'isNull',
      value: toBoolean(value, parameter),
    };
  }

  if (operatorName === 'in') {
    // 빈 IN은 언제나 거짓이라 결과가 항상 비는데, 사용자는 필터가 무시됐다고 읽는다.
    if (value === '') {
      throw invalidFilter(parameter, 'the "in" operator requires at least one value');
    }
    const parts = value.split(',');
    return {
      parameter,
      property: field.property,
      operator: 'in',
      value: parts.map((part) => toScalar(part, field, parameter)),
    };
  }

  return {
    parameter,
    property: field.property,
    operator: operatorName,
    value: toScalar(value, field, parameter),
  };
}

/**
 * 질의 파라미터에서 필터 조건을 뽑는다.
 *
 * filter가 아닌 키는 그냥 지나친다 — 알 수 없는 파라미터를 거부하는 것은 `query.ts`의
 * 책임이고, 두 곳에서 하면 오류 코드가 갈라진다.
 */
export function parseFilters(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): FilterCondition[] {
  const conditions: FilterCondition[] = [];

  for (const [key, raw] of Object.entries(query)) {
    const matched = FILTER_KEY_PATTERN.exec(key);
    if (matched === null) {
      continue;
    }
    const fieldName = matched[1];
    if (fieldName === undefined) {
      continue;
    }
    conditions.push(conditionFor(key, fieldName, matched[2] ?? 'exact', raw, policy));
  }

  return conditions;
}
