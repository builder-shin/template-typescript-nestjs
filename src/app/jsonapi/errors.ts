/**
 * JSON:API 오류 카탈로그.
 *
 * 참조 구현(`template-python-fastapi`)과 동일한 24개 코드를 유지한다. 코드가
 * 오류의 정체성이고, 메시지는 표현일 뿐이다 — 클라이언트는 `code`로 분기하고
 * 사람은 `Accept-Language`에 따라 고른 메시지를 읽는다.
 *
 * 이 파일이 코드 → (ko title·detail, en title·detail, HTTP status)의 유일한
 * 소유자다. 새 오류 상황이 생기면 여기에 코드를 추가하고, 호출 지점은
 * `JsonApiError`만 던진다 - 문구를 손으로 붙이지 않는다.
 *
 * 문구는 정본(`template-python-fastapi`의 `app/jsonapi/errors.py`)에서 그대로
 * 옮겨 왔다. 세 백엔드가 같은 코드에 같은 문구를 내야 프론트엔드가 번역 사전을
 * 두지 않고 `detail`을 그대로 그릴 수 있다(설계 스펙 9.2).
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

/** 한 언어의 표현. `title`은 오류의 종류, `detail`은 사람이 읽는 설명이다. */
export interface ErrorMessage {
  readonly title: string;
  readonly detail: string;
}

/**
 * 한 오류 코드의 표현과 HTTP 상태.
 *
 * **`detail`도 카탈로그가 갖는다.** 예전에는 `title`만 언어별로 두고 `detail`은
 * 던지는 쪽이 영문 문자열로 붙였는데, 그러면 `Accept-Language: ko`를 줘도
 * `detail`이 영문으로 나가고 값에 따라 사용자 입력이 그대로 실렸다. 정본
 * (`template-python-fastapi`의 `app/jsonapi/errors.py`)과 Rails 는 둘 다 카탈로그
 * 문구를 협상해 내보낸다 - 문구는 여기 한 곳에서만 관리한다.
 *
 * 무엇이 잘못됐는지는 `source`(pointer·parameter)가 말한다. 자유 문자열이 아니다.
 */
export interface ErrorCatalogEntry {
  readonly ko: ErrorMessage;
  readonly en: ErrorMessage;
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
    ko: { title: '허용할 수 없는 응답 형식', detail: '요청한 응답 형식을 지원하지 않습니다.' },
    en: { title: 'Not acceptable', detail: 'The requested response format is not supported.' },
    status: 406,
  },
  UNSUPPORTED_MEDIA_TYPE: {
    ko: {
      title: '지원하지 않는 미디어 타입',
      detail: '요청 본문은 JSON:API 미디어 타입을 사용해야 합니다.',
    },
    en: {
      title: 'Unsupported media type',
      detail: 'The request body must use the JSON:API media type.',
    },
    status: 415,
  },
  INVALID_JSONAPI_DOCUMENT: {
    ko: {
      title: '유효하지 않은 JSON:API 문서',
      detail: '요청 문서가 JSON:API 형식에 맞지 않습니다.',
    },
    en: {
      title: 'Invalid JSON:API document',
      detail: 'The request document does not conform to JSON:API.',
    },
    status: 400,
  },
  INVALID_QUERY_PARAMETER: {
    ko: {
      title: '유효하지 않은 쿼리 매개변수',
      detail: '지원하지 않거나 잘못된 쿼리 매개변수입니다.',
    },
    en: {
      title: 'Invalid query parameter',
      detail: 'A query parameter is unsupported or invalid.',
    },
    status: 400,
  },
  INVALID_FILTER: {
    ko: { title: '유효하지 않은 필터', detail: '지원하지 않거나 잘못된 필터입니다.' },
    en: { title: 'Invalid filter', detail: 'A filter is unsupported or invalid.' },
    status: 400,
  },
  INVALID_SORT: {
    ko: { title: '유효하지 않은 정렬', detail: '지원하지 않거나 잘못된 정렬 항목입니다.' },
    en: { title: 'Invalid sort', detail: 'A sort field is unsupported or invalid.' },
    status: 400,
  },
  INVALID_INCLUDE: {
    ko: { title: '유효하지 않은 포함 경로', detail: '지원하지 않거나 잘못된 포함 경로입니다.' },
    en: { title: 'Invalid include path', detail: 'An include path is unsupported or invalid.' },
    status: 400,
  },
  INVALID_PAGE: {
    ko: { title: '유효하지 않은 페이지', detail: '페이지 매개변수가 허용 범위를 벗어났습니다.' },
    en: { title: 'Invalid page', detail: 'A page parameter is outside the allowed range.' },
    status: 400,
  },
  RESOURCE_NOT_FOUND: {
    ko: { title: '리소스를 찾을 수 없음', detail: '요청한 리소스를 찾을 수 없습니다.' },
    en: { title: 'Resource not found', detail: 'The requested resource could not be found.' },
    status: 404,
  },
  RELATIONSHIP_RESOURCE_NOT_FOUND: {
    ko: { title: '관계 리소스를 찾을 수 없음', detail: '요청한 관계 리소스를 찾을 수 없습니다.' },
    en: {
      title: 'Relationship resource not found',
      detail: 'The requested relationship resource could not be found.',
    },
    status: 404,
  },
  TYPE_MISMATCH: {
    ko: {
      title: '리소스 타입 불일치',
      detail: '요청한 리소스 타입이 대상 타입과 일치하지 않습니다.',
    },
    en: {
      title: 'Resource type mismatch',
      detail: 'The resource type does not match the target type.',
    },
    status: 409,
  },
  ID_MISMATCH: {
    ko: { title: '리소스 ID 불일치', detail: '문서의 리소스 ID가 요청 경로와 일치하지 않습니다.' },
    en: {
      title: 'Resource ID mismatch',
      detail: 'The document resource ID does not match the request path.',
    },
    status: 409,
  },
  CLIENT_GENERATED_ID_UNSUPPORTED: {
    ko: {
      title: '클라이언트 생성 ID 미지원',
      detail: '이 생성 엔드포인트는 클라이언트가 지정한 리소스 ID를 지원하지 않습니다.',
    },
    en: {
      title: 'Client-generated ID unsupported',
      detail: 'This create endpoint does not support a client-generated resource ID.',
    },
    status: 403,
  },
  RESOURCE_CONFLICT: {
    ko: { title: '리소스 충돌', detail: '현재 리소스 상태와 요청이 충돌합니다.' },
    en: {
      title: 'Resource conflict',
      detail: 'The request conflicts with the current resource state.',
    },
    status: 409,
  },
  VALIDATION_ERROR: {
    ko: { title: '유효하지 않은 요청', detail: '요청 값이 유효성 검사를 통과하지 못했습니다.' },
    en: { title: 'Invalid request', detail: 'A request value failed validation.' },
    status: 422,
  },
  INTERNAL_SERVER_ERROR: {
    ko: { title: '서버 내부 오류', detail: '요청을 처리하는 중 서버 오류가 발생했습니다.' },
    en: {
      title: 'Internal server error',
      detail: 'The server encountered an error while processing the request.',
    },
    status: 500,
  },
  HTTP_ERROR: {
    ko: { title: 'HTTP 요청 오류', detail: 'HTTP 요청을 처리할 수 없습니다.' },
    en: { title: 'HTTP request error', detail: 'The HTTP request could not be processed.' },
    status: 500,
  },
  AUTHENTICATION_REQUIRED: {
    ko: { title: '인증 필요', detail: '이 요청에는 인증이 필요합니다.' },
    en: {
      title: 'Authentication required',
      detail: 'Authentication is required for this request.',
    },
    status: 401,
  },
  INVALID_CREDENTIALS: {
    ko: { title: '잘못된 인증 정보', detail: '이메일 또는 비밀번호가 올바르지 않습니다.' },
    en: { title: 'Invalid credentials', detail: 'The email or password is incorrect.' },
    status: 401,
  },
  INVALID_TOKEN: {
    ko: { title: '유효하지 않은 토큰', detail: '인증 토큰이 유효하지 않습니다.' },
    en: { title: 'Invalid token', detail: 'The authentication token is invalid.' },
    status: 401,
  },
  TOKEN_EXPIRED: {
    ko: { title: '만료된 토큰', detail: '인증 토큰이 만료되었습니다.' },
    en: { title: 'Token expired', detail: 'The authentication token has expired.' },
    status: 401,
  },
  TOKEN_REVOKED: {
    ko: { title: '폐기된 토큰', detail: '인증 토큰이 폐기되었습니다.' },
    en: { title: 'Token revoked', detail: 'The authentication token has been revoked.' },
    status: 401,
  },
  USER_INACTIVE: {
    ko: { title: '비활성 사용자', detail: '사용자 계정이 비활성 상태입니다.' },
    en: { title: 'User inactive', detail: 'The user account is inactive.' },
    status: 403,
  },
  EMAIL_ALREADY_REGISTERED: {
    ko: { title: '이미 등록된 이메일', detail: '이미 등록된 이메일입니다.' },
    en: { title: 'Email already registered', detail: 'The email address is already registered.' },
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

/**
 * `JsonApiError` 생성 옵션.
 *
 * **`detail`이 없다.** 문구는 카탈로그가 언어별로 갖고, 무엇이 잘못됐는지는
 * `source`가 말한다. 자유 문자열을 받으면 그것이 협상되지 않아 한국어 사용자에게
 * 영문이 나가고, 값을 끼워 넣게 되면 사용자 입력이 응답에 그대로 실린다.
 */
export interface JsonApiErrorOptions {
  readonly source?: JsonApiErrorSource;
  readonly status?: number;
  readonly meta?: Record<string, unknown>;
}

/**
 * 애플리케이션이 던지는 유일한 오류 타입.
 *
 * 예외 필터가 이 타입을 JSON:API 오류 문서로 변환한다. 코드가 status와 메시지를
 * 결정하므로 호출 지점은 상태 코드를 몰라도 된다.
 */
export class JsonApiError extends Error {
  readonly code: JsonApiErrorCode;
  readonly source: JsonApiErrorSource | undefined;
  readonly status: number;
  readonly meta: Record<string, unknown> | undefined;

  constructor(code: JsonApiErrorCode, options: JsonApiErrorOptions = {}) {
    const entry = ERROR_CATALOG[code];
    // `Error.message`는 서버 로그용이다. 응답에 나가는 것은 카탈로그를 협상한
    // 문구뿐이므로 여기서는 영문 title 을 그대로 쓴다.
    super(entry.en.title);
    this.name = 'JsonApiError';
    this.code = code;
    this.source = options.source;
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
