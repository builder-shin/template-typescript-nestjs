/**
 * JSON:API 오류 카탈로그.
 *
 * 참조 구현(`template-python-fastapi`)과 동일한 24개 코드를 유지한다. 코드가
 * 오류의 정체성이고, 메시지는 표현일 뿐이다 — 클라이언트는 `code`로 분기하고
 * 사람은 `Accept-Language`에 따라 고른 메시지를 읽는다.
 *
 * 이 파일이 코드 → (ko 메시지, en 메시지, HTTP status)의 유일한 소유자다.
 * 새 오류 상황이 생기면 여기에 코드를 추가하고, 호출 지점은 `JsonApiError`만 던진다.
 */

/** 스펙이 고정한 오류 코드. 임의로 늘리지 않는다. */
export type JsonApiErrorCode =
  | 'NOT_ACCEPTABLE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_JSONAPI_DOCUMENT'
  | 'INVALID_QUERY_PARAMETER'
  | 'INVALID_FILTER'
  | 'INVALID_SORT'
  | 'INVALID_INCLUDE'
  | 'INVALID_PAGE'
  | 'RESOURCE_NOT_FOUND'
  | 'RELATIONSHIP_RESOURCE_NOT_FOUND'
  | 'TYPE_MISMATCH'
  | 'ID_MISMATCH'
  | 'CLIENT_GENERATED_ID_UNSUPPORTED'
  | 'RESOURCE_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'USER_INACTIVE'
  | 'EMAIL_ALREADY_REGISTERED';

/** 한 오류 코드의 표현과 HTTP 상태. */
export interface ErrorCatalogEntry {
  readonly ko: string;
  readonly en: string;
  readonly status: number;
}

/**
 * 코드 → 표현·상태 표.
 *
 * `HTTP_ERROR`는 Nest가 던진 `HttpException`을 감싸는 통로이므로 status가
 * 호출 시점에 재정의된다. 카탈로그 값 500은 재정의가 없을 때의 안전한 바닥이다.
 */
export const ERROR_CATALOG: Readonly<Record<JsonApiErrorCode, ErrorCatalogEntry>> = {
  NOT_ACCEPTABLE: {
    ko: '요청한 미디어 타입을 제공할 수 없습니다.',
    en: 'The requested media type cannot be served.',
    status: 406,
  },
  UNSUPPORTED_MEDIA_TYPE: {
    ko: '지원하지 않는 미디어 타입입니다.',
    en: 'The request media type is not supported.',
    status: 415,
  },
  INVALID_JSONAPI_DOCUMENT: {
    ko: '요청 문서가 JSON:API 형식이 아닙니다.',
    en: 'The request document is not a valid JSON:API document.',
    status: 400,
  },
  INVALID_QUERY_PARAMETER: {
    ko: '허용되지 않은 질의 파라미터입니다.',
    en: 'The query parameter is not allowed.',
    status: 400,
  },
  INVALID_FILTER: {
    ko: '허용되지 않은 필터입니다.',
    en: 'The filter is not allowed.',
    status: 400,
  },
  INVALID_SORT: {
    ko: '허용되지 않은 정렬입니다.',
    en: 'The sort field is not allowed.',
    status: 400,
  },
  INVALID_INCLUDE: {
    ko: '허용되지 않은 include 경로입니다.',
    en: 'The include path is not allowed.',
    status: 400,
  },
  INVALID_PAGE: {
    ko: '페이지 파라미터가 올바르지 않습니다.',
    en: 'The page parameters are invalid.',
    status: 400,
  },
  RESOURCE_NOT_FOUND: {
    ko: '자원을 찾을 수 없습니다.',
    en: 'The resource was not found.',
    status: 404,
  },
  RELATIONSHIP_RESOURCE_NOT_FOUND: {
    ko: '관계 대상 자원을 찾을 수 없습니다.',
    en: 'The related resource was not found.',
    status: 404,
  },
  TYPE_MISMATCH: {
    ko: '자원 타입이 일치하지 않습니다.',
    en: 'The resource type does not match.',
    status: 409,
  },
  ID_MISMATCH: {
    ko: '자원 식별자가 일치하지 않습니다.',
    en: 'The resource id does not match.',
    status: 409,
  },
  CLIENT_GENERATED_ID_UNSUPPORTED: {
    ko: '클라이언트가 생성한 식별자를 지원하지 않습니다.',
    en: 'Client-generated ids are not supported.',
    status: 403,
  },
  RESOURCE_CONFLICT: {
    ko: '자원 상태가 충돌합니다.',
    en: 'The resource state conflicts with the request.',
    status: 409,
  },
  VALIDATION_ERROR: {
    ko: '입력값 검증에 실패했습니다.',
    en: 'The request payload failed validation.',
    status: 422,
  },
  INTERNAL_SERVER_ERROR: {
    ko: '서버 내부 오류가 발생했습니다.',
    en: 'An internal server error occurred.',
    status: 500,
  },
  HTTP_ERROR: {
    ko: '요청을 처리할 수 없습니다.',
    en: 'The request could not be processed.',
    status: 500,
  },
  AUTHENTICATION_REQUIRED: {
    ko: '인증이 필요합니다.',
    en: 'Authentication is required.',
    status: 401,
  },
  INVALID_CREDENTIALS: {
    ko: '자격 증명이 올바르지 않습니다.',
    en: 'The credentials are invalid.',
    status: 401,
  },
  INVALID_TOKEN: {
    ko: '토큰이 올바르지 않습니다.',
    en: 'The token is invalid.',
    status: 401,
  },
  TOKEN_EXPIRED: {
    ko: '토큰이 만료되었습니다.',
    en: 'The token has expired.',
    status: 401,
  },
  TOKEN_REVOKED: {
    ko: '토큰이 폐기되었습니다.',
    en: 'The token has been revoked.',
    status: 401,
  },
  USER_INACTIVE: {
    ko: '비활성 사용자입니다.',
    en: 'The user is inactive.',
    status: 403,
  },
  EMAIL_ALREADY_REGISTERED: {
    ko: '이미 등록된 이메일입니다.',
    en: 'The email address is already registered.',
    status: 409,
  },
};

/** 카탈로그에 등재된 모든 코드. 순서는 선언 순서를 따른다. */
export const ERROR_CODES: readonly JsonApiErrorCode[] = Object.keys(
  ERROR_CATALOG,
) as JsonApiErrorCode[];

/** 카탈로그 항목을 읽는다. */
export function catalogEntry(code: JsonApiErrorCode): ErrorCatalogEntry {
  return ERROR_CATALOG[code];
}

/** JSON:API 오류 객체의 `source` 멤버. pointer와 parameter 중 하나만 쓴다. */
export interface JsonApiErrorSource {
  readonly pointer?: string;
  readonly parameter?: string;
}

/** `JsonApiError` 생성 옵션. */
export interface JsonApiErrorOptions {
  readonly source?: JsonApiErrorSource;
  readonly detail?: string;
  readonly status?: number;
  readonly meta?: Record<string, unknown>;
}

/**
 * 애플리케이션이 던지는 유일한 오류 타입.
 *
 * 예외 필터가 이 타입을 JSON:API 오류 문서로 변환한다. 코드가 status와 메시지를
 * 결정하므로 호출 지점은 상태 코드를 몰라도 된다. `detail`을 주면 카탈로그 메시지
 * 대신 그 문자열이 오류 객체의 `detail`로 나간다.
 */
export class JsonApiError extends Error {
  readonly code: JsonApiErrorCode;
  readonly source: JsonApiErrorSource | undefined;
  readonly detail: string | undefined;
  readonly status: number;
  readonly meta: Record<string, unknown> | undefined;

  constructor(code: JsonApiErrorCode, options: JsonApiErrorOptions = {}) {
    const entry = ERROR_CATALOG[code];
    super(entry.en);
    this.name = 'JsonApiError';
    this.code = code;
    this.source = options.source;
    this.detail = options.detail;
    this.status = options.status ?? entry.status;
    this.meta = options.meta;
  }
}

/**
 * 한 요청에서 동시에 발생한 여러 오류.
 *
 * 쓰기 스키마 검증은 필드 여러 개가 한꺼번에 틀릴 수 있다. 첫 오류만 돌려주면
 * 클라이언트가 하나씩 고치며 왕복해야 하므로, 한 번에 모두 알려 준다.
 *
 * `status`는 첫 오류의 것을 쓴다. JSON:API는 여러 오류의 status가 갈릴 때 상위
 * 자릿수로 뭉개라고 권하지만, 이 템플릿에서 집합으로 나가는 것은 같은 코드의
 * 검증 오류뿐이라 그 규칙이 쓰일 자리가 없다 — 갈리는 집합을 만들게 되면 그때
 * 뭉개는 규칙을 여기 넣는다.
 */
export class JsonApiErrors extends Error {
  readonly errors: readonly JsonApiError[];
  readonly status: number;

  constructor(errors: readonly JsonApiError[]) {
    const [first] = errors;
    if (first === undefined) {
      throw new TypeError('JsonApiErrors는 오류를 하나 이상 담아야 한다');
    }
    super(first.message);
    this.name = 'JsonApiErrors';
    this.errors = errors;
    this.status = first.status;
  }
}
