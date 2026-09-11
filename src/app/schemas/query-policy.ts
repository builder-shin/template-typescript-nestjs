/**
 * 자원별 조회 허용 목록.
 *
 * 이 계층은 "무엇을 질의할 수 있는가"만 소유한다. 실제 SQL 조립은
 * `jsonapi/query-compiler.ts`가 하고, 요청 문자열 해석은 `jsonapi/`의 파서들이 한다.
 *
 * **열 이름은 언제나 이 선언에서만 나온다.** 사용자가 보낸 문자열은 이 표의 키를 찾는
 * 데만 쓰이고, SQL에 들어가는 것은 표가 들고 있는 `property`다. 이 규칙이 깨지면
 * 조회 파라미터가 곧바로 SQL 주입 경로가 된다.
 *
 * 예외 하나: `tieBreaker.field`가 공개 `sorts` 표에 없으면 표를 거치지 않고 그 필드
 * 이름을 그대로 property로 쓴다(표에 있으면 declared `property`를 쓴다) —
 * `jsonapi/sort.ts`의 `resolveTieBreaker`. 어느 경우든 안전한 이유는 그 값이 사용자
 * 입력이 아니라 정책 선언이기 때문이다.
 */

/** 스펙 8.1이 정한 연산자. 임의로 늘리지 않는다. */
export type FilterOperator = 'exact' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'isNull';

/** 연산자 목록. 순서는 선언 순서를 따른다. */
export const FILTER_OPERATORS: readonly FilterOperator[] = [
  'exact',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'isNull',
];

/** 문자열이 알려진 연산자인지 판정한다. */
export function isFilterOperator(value: string): value is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(value);
}

/**
 * 필터 값의 저장 형식.
 *
 * 파서가 이 값을 보고 문자열을 엄격하게 변환한다. `'2026-13-40'`이나 `'참'` 같은 값은
 * 여기서 걸러지고 SQL까지 가지 않는다.
 */
export type FilterValueType =
  'string' | 'number' | 'integer' | 'boolean' | 'uuid' | 'timestamp' | 'enum';

/** 필터 가능한 필드 하나의 정책. */
export interface FilterFieldPolicy {
  /** 엔티티 프로퍼티 이름. SQL에 들어가는 것은 언제나 이 값이다. */
  readonly property: string;
  readonly type: FilterValueType;
  readonly operators: readonly FilterOperator[];
  /** `type`이 `'enum'`일 때 허용 값. 다른 타입에서는 쓰지 않는다. */
  readonly values?: readonly string[];
}

/** 정렬 가능한 필드 하나의 정책. */
export interface SortFieldPolicy {
  /** 엔티티 프로퍼티 이름. */
  readonly property: string;
  /**
   * 이 컬럼이 NULL을 허용하는가.
   *
   * keyset 커서는 `(컬럼, id) > (값, 값)` 비교로 자르는데, NULL이 섞이면 비교가
   * unknown이 되어 행을 조용히 건너뛴다. 그래서 커서 모드는 nullable 정렬을
   * `INVALID_PAGE`로 거부한다(스펙 8.2).
   */
  readonly nullable: boolean;
}

/** 정렬 방향. */
export type SortDirection = 'ASC' | 'DESC';

/** 정렬 항목 하나. `field`는 공개 이름이고 정책이 프로퍼티로 옮긴다. */
export interface SortTerm {
  readonly field: string;
  readonly direction: SortDirection;
}

/** 한 페이지에 담을 수 있는 최대 개수(스펙 8.2). */
export const MAX_PAGE_SIZE = 100;

/**
 * 한 자원의 조회 정책.
 *
 * **인덱스 동기화 규칙(스펙 8.3)**: `filters`·`sorts`를 늘리거나 `defaultSort`·
 * `tieBreaker`를 바꿀 때는 해당 컬럼 조합의 인덱스 필요 여부를 같은 변경에서 판단하고,
 * 필요하면 엔티티 인덱스 선언과 마이그레이션에 함께 반영한다. 만들지 않기로 했으면
 * 근거를 정책 선언부 주석에 남긴다. 모든 정렬 뒤에 `tieBreaker`가 덧붙으므로 유용한
 * 인덱스는 `(<컬럼>, id)`다.
 */
export interface QueryPolicy {
  readonly filters: Readonly<Record<string, FilterFieldPolicy>>;
  readonly sorts: Readonly<Record<string, SortFieldPolicy>>;
  /** 허용하는 `include` 경로. 시리얼라이저의 관계 선언과 교집합을 이룬다. */
  readonly includes: readonly string[];
  /** `sort`가 없을 때 쓰는 정렬. */
  readonly defaultSort: readonly SortTerm[];
  /** 모든 정렬 뒤에 붙는 마지막 기준. 결과 순서를 전순서로 만든다. */
  readonly tieBreaker: SortTerm;
  /** `page[size]`가 없을 때 쓰는 크기. */
  readonly defaultPageSize: number;
}
