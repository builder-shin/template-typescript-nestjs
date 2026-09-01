# Phase 1-2: JSON:API 프로토콜과 영속 계층 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JSON:API 1.1 프로토콜 계층(문서 모델, 24개 오류 카탈로그, 협상, 현지화, 예외 필터, 응답 계약)과 영속 계층(엔티티, 마이그레이션, 시드, 실제 PostgreSQL 테스트 fixture)을 구현해 Phase 3-4의 선언형 CRUD가 올라설 바닥을 만든다.

**Architecture:** `src/app/jsonapi/`가 프로토콜을 단독 소유한다. 컨트롤러와 ORM은 이 모듈을 알지만 이 모듈은 둘 다 모른다 — 프로토콜은 순수 함수와 Nest 인프라(가드·필터·인터셉터)로만 구성되고 DB에 의존하지 않는다. 영속 계층은 `src/config/database.ts`가 `DataSource`를 조립하고, `src/app/models/`가 엔티티를, `src/db/`가 마이그레이션과 시드를 소유한다. 테스트는 실제 PostgreSQL을 쓰며 트랜잭션+savepoint로 롤백한다.

**Tech Stack:** NestJS 12, TypeScript 6.0.3 (ESM), TypeORM 1.1.0, pg 8, class-validator 0.15, class-transformer 0.5, Jest 30.4.2 + ts-jest 29, PostgreSQL 18

**Spec:** `docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md`

## Global Constraints

스펙에서 그대로 옮긴 프로젝트 전역 요구사항이다. 모든 태스크의 요구사항에 암묵적으로 포함된다.

- Node `>=24.11.0`. TypeScript는 **6.0.3에 고정**한다. TS 7로 올리지 않는다 — TS 7은 네이티브(Go) 컴파일러라 ts-jest가 요구하는 JS 컴파일러 API를 노출하지 않는다.
- ESM 전용(`"type": "module"`). **모든 상대 import에 `.js` 확장자를 붙인다.** `tsc`가 `TS2835`로 직접 거부하므로 `typecheck`가 게이트다.
- `tsconfig`: `module: node18`, `moduleResolution: node16`, `experimentalDecorators`, `emitDecoratorMetadata`, `isolatedModules`, `strict`.
- **PostgreSQL 전용.** 운영 코드에 SQLite 우회 경로를 넣지 않는다. 인메모리 SQLite나 모델 mock으로 DB 계약을 대체하지 않는다.
- `synchronize`는 **모든 환경에서 `false`**. 스키마 변경은 `src/db/migrations/`의 새 마이그레이션으로만 전달한다.
- 마이그레이션 명명: 파일 `src/db/migrations/<UTC yyyyMMddHHmmss>-<kebab-name>.ts`, 클래스 `<PascalName><epochMillis>`. 두 타임스탬프가 같은 시각을 가리켜야 한다. `down()`을 비워 두지 않는다.
- **암묵적 기본값 금지.** 필수 환경 변수가 없으면 변수 이름이 담긴 오류로 프로세스가 시작되지 않는다: `DATABASE_URL is required`, `DB_POOL_MAX must be an integer`.
- 오류 응답은 **전부** JSON:API 오류 문서다. Nest 기본 오류 형식이 외부로 나가지 않는다.
- `Accept-Language` 기본값은 `ko`. 품질값(`q`)과 명시도를 고려한다.
- Jest 커버리지 게이트 **80%**. 현재 저장소는 100%를 유지하고 있다.
- **배포된 지 24시간이 지나지 않은 패키지 버전을 고정하지 않는다** (pnpm 11의 `minimumReleaseAge` 공급망 게이트).
- 커밋 메시지와 PR 본문에 AI 생성 표시(`Co-Authored-By: Claude`, `Generated with Claude Code` 등)를 넣지 않는다.
- 코드 주석과 문서는 한국어로 쓴다. 식별자는 영어.
- 각 태스크는 끝날 때 해당 테스트가 통과해야 하고, 마지막 태스크는 `./scripts/check.sh` 전체를 통과해야 한다.

## File Structure

이 계획이 만들거나 고치는 파일과 각각의 책임이다.

### 프로토콜 계층 (Phase 1)

| 파일 | 책임 |
| --- | --- |
| `src/app/jsonapi/errors.ts` | 24개 오류 코드, `ERROR_CATALOG`(코드 → ko/en 메시지 + HTTP status), `JsonApiError` |
| `src/app/jsonapi/language.ts` | `Accept-Language` 해석(`q` 품질값, 명시도, 기본 `ko`) |
| `src/app/jsonapi/document.ts` | JSON:API 문서 타입과 요청 문서 파싱·검증, `presentKeys` 캡처 |
| `src/app/jsonapi/negotiation.ts` | `JsonApiNegotiationGuard` — `Accept` 406, `Content-Type` 415 |
| `src/app/jsonapi/exception-filter.ts` | 전역 `JsonApiExceptionFilter` — 모든 오류를 JSON:API 오류 문서로 |
| `src/app/jsonapi/response.ts` | 응답 인터셉터 — vendor `Content-Type` 부착 |

### 영속 계층 (Phase 2)

| 파일 | 책임 |
| --- | --- |
| `src/config/settings.ts` (수정) | `DatabaseSettings` 추가 — `DATABASE_URL`, `DB_POOL_*` |
| `src/config/database.ts` | `DataSource` 옵션 조립 |
| `src/config/data-source.ts` | TypeORM CLI 전용 `DataSource` export |
| `src/app/models/category.entity.ts` | `Category` 엔티티 |
| `src/app/models/tag.entity.ts` | `Tag` 엔티티 |
| `src/app/models/example.entity.ts` | `Example` 엔티티 — category(to-one), tags(to-many) |
| `src/db/migrations/20260829000000-create-example-schema.ts` | 초기 스키마 |
| `src/db/seeds.ts` | 결정적 시드 (고정 UUID + upsert) |

### 조립과 테스트

| 파일 | 책임 |
| --- | --- |
| `src/config/app.module.ts` (수정) | 전역 필터·인터셉터 등록, `TypeOrmModule` 연결 |
| `src/app/controllers/health.controller.ts` (수정) | readiness가 DB를 확인 |
| `test/db/fixture.ts` | `TEST_DATABASE_URL` 검증, 마이그레이션 head, 트랜잭션+savepoint 롤백 |
| `test/jsonapi/*.spec.ts` | 프로토콜 단위 테스트 |
| `test/integration/*.spec.ts` | 마이그레이션 적용, 시드 결정성 |

---

## Task 1: 오류 카탈로그와 `JsonApiError`

**Files:**
- Create: `src/app/jsonapi/errors.ts`
- Test: `test/jsonapi/errors.spec.ts`

**Interfaces:**
- Consumes: 없음 (이 계획의 첫 태스크)
- Produces:
  - `type JsonApiErrorCode` — 24개 코드의 union
  - `const ERROR_CODES: readonly JsonApiErrorCode[]`
  - `interface ErrorCatalogEntry { readonly ko: string; readonly en: string; readonly status: number }`
  - `const ERROR_CATALOG: Readonly<Record<JsonApiErrorCode, ErrorCatalogEntry>>`
  - `interface JsonApiErrorSource { readonly pointer?: string; readonly parameter?: string }`
  - `class JsonApiError extends Error` — `constructor(code: JsonApiErrorCode, options?: { source?: JsonApiErrorSource; detail?: string; status?: number; meta?: Record<string, unknown> })`, 공개 필드 `code`, `source`, `detail`, `status`, `meta`
  - `function catalogEntry(code: JsonApiErrorCode): ErrorCatalogEntry`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/jsonapi/errors.spec.ts`:

```ts
import {
  ERROR_CATALOG,
  ERROR_CODES,
  JsonApiError,
  catalogEntry,
} from '../../src/app/jsonapi/errors.js';

describe('오류 카탈로그', () => {
  it('스펙이 정한 24개 코드를 모두 가진다', () => {
    expect(ERROR_CODES).toHaveLength(24);
  });

  it('참조 구현과 같은 코드 집합을 가진다', () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        'AUTHENTICATION_REQUIRED',
        'CLIENT_GENERATED_ID_UNSUPPORTED',
        'EMAIL_ALREADY_REGISTERED',
        'HTTP_ERROR',
        'ID_MISMATCH',
        'INTERNAL_SERVER_ERROR',
        'INVALID_CREDENTIALS',
        'INVALID_FILTER',
        'INVALID_INCLUDE',
        'INVALID_JSONAPI_DOCUMENT',
        'INVALID_PAGE',
        'INVALID_QUERY_PARAMETER',
        'INVALID_SORT',
        'INVALID_TOKEN',
        'NOT_ACCEPTABLE',
        'RELATIONSHIP_RESOURCE_NOT_FOUND',
        'RESOURCE_CONFLICT',
        'RESOURCE_NOT_FOUND',
        'TOKEN_EXPIRED',
        'TOKEN_REVOKED',
        'TYPE_MISMATCH',
        'UNSUPPORTED_MEDIA_TYPE',
        'USER_INACTIVE',
        'VALIDATION_ERROR',
      ].sort(),
    );
  });

  it('모든 코드가 ko/en 메시지와 HTTP status를 가진다', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry.ko.length).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
    }
  });

  it('ko와 en 메시지가 서로 다르다', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CATALOG[code].ko).not.toBe(ERROR_CATALOG[code].en);
    }
  });

  it('스펙이 정한 status를 코드별로 고정한다', () => {
    expect(ERROR_CATALOG.NOT_ACCEPTABLE.status).toBe(406);
    expect(ERROR_CATALOG.UNSUPPORTED_MEDIA_TYPE.status).toBe(415);
    expect(ERROR_CATALOG.INVALID_JSONAPI_DOCUMENT.status).toBe(400);
    expect(ERROR_CATALOG.RESOURCE_NOT_FOUND.status).toBe(404);
    expect(ERROR_CATALOG.RELATIONSHIP_RESOURCE_NOT_FOUND.status).toBe(404);
    expect(ERROR_CATALOG.TYPE_MISMATCH.status).toBe(409);
    expect(ERROR_CATALOG.ID_MISMATCH.status).toBe(409);
    expect(ERROR_CATALOG.CLIENT_GENERATED_ID_UNSUPPORTED.status).toBe(403);
    expect(ERROR_CATALOG.RESOURCE_CONFLICT.status).toBe(409);
    expect(ERROR_CATALOG.VALIDATION_ERROR.status).toBe(422);
    expect(ERROR_CATALOG.INTERNAL_SERVER_ERROR.status).toBe(500);
    expect(ERROR_CATALOG.AUTHENTICATION_REQUIRED.status).toBe(401);
    expect(ERROR_CATALOG.USER_INACTIVE.status).toBe(403);
    expect(ERROR_CATALOG.EMAIL_ALREADY_REGISTERED.status).toBe(409);
  });

  it('catalogEntry가 카탈로그 항목을 돌려준다', () => {
    expect(catalogEntry('INVALID_SORT')).toBe(ERROR_CATALOG.INVALID_SORT);
  });
});

describe('JsonApiError', () => {
  it('코드의 기본 status를 물려받는다', () => {
    const error = new JsonApiError('RESOURCE_NOT_FOUND');
    expect(error.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.source).toBeUndefined();
    expect(error.detail).toBeUndefined();
  });

  it('Error를 상속하고 name이 클래스 이름이다', () => {
    const error = new JsonApiError('INVALID_FILTER');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('JsonApiError');
  });

  it('message가 카탈로그의 en 메시지다', () => {
    const error = new JsonApiError('INVALID_SORT');
    expect(error.message).toBe(ERROR_CATALOG.INVALID_SORT.en);
  });

  it('source pointer를 보존한다', () => {
    const error = new JsonApiError('VALIDATION_ERROR', {
      source: { pointer: '/data/attributes/title' },
    });
    expect(error.source).toEqual({ pointer: '/data/attributes/title' });
  });

  it('source parameter를 보존한다', () => {
    const error = new JsonApiError('INVALID_FILTER', {
      source: { parameter: 'filter[unknown]' },
    });
    expect(error.source).toEqual({ parameter: 'filter[unknown]' });
  });

  it('detail 재정의를 보존한다', () => {
    const error = new JsonApiError('INVALID_PAGE', { detail: 'page[size] must be <= 100' });
    expect(error.detail).toBe('page[size] must be <= 100');
  });

  it('HTTP_ERROR는 status 재정의를 받는다', () => {
    const error = new JsonApiError('HTTP_ERROR', { status: 418 });
    expect(error.status).toBe(418);
  });

  it('meta를 보존한다', () => {
    const error = new JsonApiError('RESOURCE_CONFLICT', { meta: { conflictingId: 'abc' } });
    expect(error.meta).toEqual({ conflictingId: 'abc' });
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `pnpm exec jest test/jsonapi/errors.spec.ts`

기대: `Cannot find module '../../src/app/jsonapi/errors.js'`로 FAIL.

주의: 이 저장소의 Jest는 ESM이므로 `pnpm exec jest`가 아니라 `pnpm test:quick -- test/jsonapi/errors.spec.ts`로 돌려야 `--experimental-vm-modules`가 붙는다. `package.json`의 `test:quick`을 확인하고 그 형태를 쓴다.

- [ ] **Step 3: 구현 작성**

`src/app/jsonapi/errors.ts`:

```ts
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
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인**

실행: `pnpm test:quick -- test/jsonapi/errors.spec.ts`
기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/jsonapi/errors.ts test/jsonapi/errors.spec.ts
git commit -m "feat(jsonapi): 24개 오류 코드 카탈로그와 JsonApiError 추가"
```

---

## Task 2: `Accept-Language` 해석

**Files:**
- Create: `src/app/jsonapi/language.ts`
- Test: `test/jsonapi/language.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type SupportedLanguage = 'ko' | 'en'`
  - `const DEFAULT_LANGUAGE: SupportedLanguage` (= `'ko'`)
  - `const SUPPORTED_LANGUAGES: readonly SupportedLanguage[]`
  - `function resolveLanguage(header: string | undefined): SupportedLanguage`

**설계 근거:** 참조 구현의 `resolve_language` 알고리즘을 그대로 옮긴다. RFC 9110의 `Accept-Language`는 `ko-KR,ko;q=0.9,en;q=0.8` 형태로 오고, 품질값이 같으면 더 명시적인 태그(`ko-KR` > `ko`)가 이긴다. `q=0`은 거부를 뜻하므로 후보에서 제외한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/jsonapi/language.spec.ts`:

```ts
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  resolveLanguage,
} from '../../src/app/jsonapi/language.js';

describe('resolveLanguage', () => {
  it('기본 언어는 ko다', () => {
    expect(DEFAULT_LANGUAGE).toBe('ko');
  });

  it('ko와 en만 지원한다', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(['en', 'ko']);
  });

  it('헤더가 없으면 기본 언어', () => {
    expect(resolveLanguage(undefined)).toBe('ko');
  });

  it('빈 헤더면 기본 언어', () => {
    expect(resolveLanguage('')).toBe('ko');
    expect(resolveLanguage('   ')).toBe('ko');
  });

  it('단일 태그를 해석한다', () => {
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('ko')).toBe('ko');
  });

  it('지역 하위 태그를 기본 언어로 접는다', () => {
    expect(resolveLanguage('en-US')).toBe('en');
    expect(resolveLanguage('ko-KR')).toBe('ko');
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(resolveLanguage('EN-us')).toBe('en');
    expect(resolveLanguage('KO')).toBe('ko');
  });

  it('품질값이 높은 쪽을 고른다', () => {
    expect(resolveLanguage('ko;q=0.3, en;q=0.9')).toBe('en');
    expect(resolveLanguage('en;q=0.3, ko;q=0.9')).toBe('ko');
  });

  it('q를 생략하면 1.0으로 본다', () => {
    expect(resolveLanguage('en, ko;q=0.9')).toBe('en');
  });

  it('품질값이 같으면 더 명시적인 태그가 이긴다', () => {
    expect(resolveLanguage('en;q=0.8, en-GB;q=0.8')).toBe('en');
    expect(resolveLanguage('ko;q=0.5, en-US;q=0.5, en;q=0.5')).toBe('en');
  });

  it('품질값과 명시도가 모두 같으면 먼저 온 쪽이 이긴다', () => {
    expect(resolveLanguage('en, ko')).toBe('en');
    expect(resolveLanguage('ko, en')).toBe('ko');
  });

  it('q=0은 거부이므로 후보에서 뺀다', () => {
    expect(resolveLanguage('en;q=0, ko;q=0.1')).toBe('ko');
    expect(resolveLanguage('en;q=0')).toBe('ko');
  });

  it('지원하지 않는 언어만 오면 기본 언어', () => {
    expect(resolveLanguage('fr, de;q=0.9')).toBe('ko');
  });

  it('지원하지 않는 언어를 건너뛰고 지원하는 언어를 고른다', () => {
    expect(resolveLanguage('fr;q=1.0, en;q=0.1')).toBe('en');
  });

  it('와일드카드는 기본 언어로 해석한다', () => {
    expect(resolveLanguage('*')).toBe('ko');
  });

  it('와일드카드보다 명시된 지원 언어를 우선한다', () => {
    expect(resolveLanguage('*;q=0.9, en;q=0.1')).toBe('en');
  });

  it('깨진 q 값은 해당 항목을 버린다', () => {
    expect(resolveLanguage('en;q=abc, ko;q=0.5')).toBe('ko');
  });

  it('빈 항목을 건너뛴다', () => {
    expect(resolveLanguage('en,,ko')).toBe('en');
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/jsonapi/language.spec.ts`
기대: `Cannot find module '../../src/app/jsonapi/language.js'`로 FAIL.

- [ ] **Step 3: 구현 작성**

`src/app/jsonapi/language.ts`:

```ts
/**
 * `Accept-Language` 해석.
 *
 * 오류 메시지의 언어를 고르는 단 하나의 규칙이다. 참조 구현의 `resolve_language`를
 * 그대로 옮겼다 — 품질값(`q`)이 1순위, 태그 명시도가 2순위, 헤더 등장 순서가 3순위다.
 * `q=0`은 RFC 9110에서 명시적 거부이므로 후보에서 제외한다.
 *
 * 지원하지 않는 언어만 요청되면 기본값 `ko`를 쓴다. 요청을 거절하지 않는다 —
 * 언어 협상 실패는 오류가 아니라 기본값으로 되돌아갈 사유다.
 */

/** 이 템플릿이 메시지를 제공하는 언어. */
export type SupportedLanguage = 'ko' | 'en';

/** 협상이 실패했을 때 쓰는 언어. */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ko';

/** 지원 언어 목록. */
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ['ko', 'en'];

interface LanguageRange {
  /** 기본 하위 태그(`en-GB` → `en`). 와일드카드면 `*`. */
  readonly base: string;
  /** 품질값. 0 초과 1 이하. */
  readonly quality: number;
  /** 하위 태그 개수. 같은 품질값에서 더 명시적인 쪽을 고르는 데 쓴다. */
  readonly specificity: number;
  /** 헤더 등장 순서. 앞의 두 기준이 같을 때의 tie breaker. */
  readonly position: number;
}

function isSupported(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** `en-GB;q=0.8` 한 항목을 파싱한다. 형식이 깨졌거나 q=0이면 `undefined`. */
function parseRange(raw: string, position: number): LanguageRange | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }

  const [tagPart, ...parameters] = trimmed.split(';');
  const tag = tagPart.trim().toLowerCase();
  if (tag === '') {
    return undefined;
  }

  let quality = 1;
  for (const parameter of parameters) {
    const [key, value] = parameter.split('=');
    if (key === undefined || value === undefined || key.trim().toLowerCase() !== 'q') {
      continue;
    }
    const parsed = Number.parseFloat(value.trim());
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    quality = parsed;
  }

  if (quality <= 0) {
    return undefined;
  }

  const subtags = tag.split('-');
  return {
    base: subtags[0],
    quality,
    specificity: subtags.length,
    position,
  };
}

/** 두 후보 중 우선하는 쪽을 고른다. 품질값 → 명시도 → 등장 순서. */
function outranks(candidate: LanguageRange, incumbent: LanguageRange): boolean {
  if (candidate.quality !== incumbent.quality) {
    return candidate.quality > incumbent.quality;
  }
  if (candidate.specificity !== incumbent.specificity) {
    return candidate.specificity > incumbent.specificity;
  }
  return candidate.position < incumbent.position;
}

/**
 * `Accept-Language` 헤더에서 응답 언어를 고른다.
 *
 * 지원하지 않는 언어와 와일드카드는 후보에서 빠지고, 남은 후보가 없으면 기본값을 쓴다.
 */
export function resolveLanguage(header: string | undefined): SupportedLanguage {
  if (header === undefined || header.trim() === '') {
    return DEFAULT_LANGUAGE;
  }

  let best: LanguageRange | undefined;
  let bestLanguage: SupportedLanguage | undefined;

  header.split(',').forEach((raw, index) => {
    const range = parseRange(raw, index);
    if (range === undefined || !isSupported(range.base)) {
      return;
    }
    if (best === undefined || outranks(range, best)) {
      best = range;
      bestLanguage = range.base;
    }
  });

  return bestLanguage ?? DEFAULT_LANGUAGE;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인**

실행: `pnpm test:quick -- test/jsonapi/language.spec.ts`
기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/jsonapi/language.ts test/jsonapi/language.spec.ts
git commit -m "feat(jsonapi): Accept-Language 품질값 해석 추가"
```

---
## Task 3: JSON:API 문서 모델과 요청 문서 파싱

**Files:**
- Create: `src/app/jsonapi/document.ts`
- Test: `test/jsonapi/document.spec.ts`

**Interfaces:**
- Consumes: `JsonApiError`, `JsonApiErrorCode` from `./errors.js` (Task 1)
- Produces:
  - `interface ResourceIdentifier { readonly type: string; readonly id: string }`
  - `interface RelationshipInput { readonly data: ResourceIdentifier | readonly ResourceIdentifier[] | null }`
  - `interface ParsedResourceInput` — `{ type, id, attributes, relationships, presentKeys }`
  - `interface ParseResourceOptions` — `{ expectedType, expectedId?, allowClientGeneratedId? }`
  - `function parseResourceInput(body: unknown, options: ParseResourceOptions): ParsedResourceInput`
  - `function parseLinkageInput(body: unknown, options: { expectedType: string; cardinality: 'one' | 'many' }): ResourceIdentifier | ResourceIdentifier[] | null`

**설계 근거:** 이 파일은 "요청 본문이 JSON:API 문서인가"만 판정한다. 필드값이 도메인 규칙에 맞는지(길이, 범위, 형식)는 Phase 4의 `concerns/document-parsing.ts`가 class-validator로 판정한다. 두 책임을 섞으면 프로토콜 오류(`INVALID_JSONAPI_DOCUMENT`, 400)와 검증 오류(`VALIDATION_ERROR`, 422)의 경계가 흐려진다.

`presentKeys`는 스펙 7.1이 요구하는 "보내지 않은 필드 vs `null`로 보낸 필드" 구분의 근거다. `plainToInstance`가 원본 키 정보를 지우므로 그 전에 잡아 둔다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/jsonapi/document.spec.ts`:

```ts
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { parseLinkageInput, parseResourceInput } from '../../src/app/jsonapi/document.js';

// `expect(...).toBeInstanceOf()`는 Jest 매처일 뿐 TypeScript가 아는 타입 가드가 아니다.
// 그래서 그 뒤에 `error as JsonApiError`를 쓰면 캐스트로 컴파일러를 침묵시키게 된다.
// 원시 `instanceof`로 좁히면 캐스트 없이 같은 안전성을 얻고, 예상 밖의 오류가 나면
// 그 오류가 그대로 터져 원인이 바로 보인다.
function expectJsonApiError(fn: () => unknown, code: string, pointer?: string): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    expect(error.code).toBe(code);
    if (pointer !== undefined) {
      expect(error.source?.pointer).toBe(pointer);
    }
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

describe('parseResourceInput', () => {
  it('최소 문서를 파싱한다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', attributes: { title: 'a' } } },
      { expectedType: 'examples' },
    );
    expect(result.type).toBe('examples');
    expect(result.id).toBeUndefined();
    expect(result.attributes).toEqual({ title: 'a' });
    expect(result.relationships).toEqual({});
  });

  it('attributes의 키 집합을 presentKeys로 잡는다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', attributes: { title: 'a', body: null } } },
      { expectedType: 'examples' },
    );
    expect([...result.presentKeys].sort()).toEqual(['body', 'title']);
  });

  it('attributes가 없으면 presentKeys가 비어 있다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples' } },
      { expectedType: 'examples' },
    );
    expect(result.presentKeys.size).toBe(0);
    expect(result.attributes).toEqual({});
  });

  it('null로 보낸 필드도 presentKeys에 들어간다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', attributes: { body: null } } },
      { expectedType: 'examples' },
    );
    expect(result.presentKeys.has('body')).toBe(true);
    expect(result.attributes.body).toBeNull();
  });

  it('관계를 파싱한다', () => {
    const result = parseResourceInput(
      {
        data: {
          type: 'examples',
          relationships: { category: { data: { type: 'categories', id: 'c1' } } },
        },
      },
      { expectedType: 'examples' },
    );
    expect(result.relationships.category).toEqual({ data: { type: 'categories', id: 'c1' } });
  });

  it('본문이 객체가 아니면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(() => parseResourceInput(null, { expectedType: 'examples' }), 'INVALID_JSONAPI_DOCUMENT');
    expectJsonApiError(() => parseResourceInput('x', { expectedType: 'examples' }), 'INVALID_JSONAPI_DOCUMENT');
    expectJsonApiError(() => parseResourceInput([], { expectedType: 'examples' }), 'INVALID_JSONAPI_DOCUMENT');
  });

  it('data 멤버가 없으면 /data를 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput({}, { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data',
    );
  });

  it('data가 객체가 아니면 /data를 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput({ data: [] }, { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data',
    );
  });

  it('type이 없으면 /data/type을 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput({ data: {} }, { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/type',
    );
  });

  it('type이 다르면 TYPE_MISMATCH', () => {
    expectJsonApiError(
      () => parseResourceInput({ data: { type: 'articles' } }, { expectedType: 'examples' }),
      'TYPE_MISMATCH',
      '/data/type',
    );
  });

  it('attributes가 객체가 아니면 /data/attributes를 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput(
        { data: { type: 'examples', attributes: [] } },
        { expectedType: 'examples' },
      ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/attributes',
    );
  });

  it('relationships가 객체가 아니면 /data/relationships를 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput(
        { data: { type: 'examples', relationships: 'x' } },
        { expectedType: 'examples' },
      ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/relationships',
    );
  });

  it('기대 id와 다르면 ID_MISMATCH', () => {
    expectJsonApiError(
      () => parseResourceInput(
        { data: { type: 'examples', id: 'other' } },
        { expectedType: 'examples', expectedId: 'mine' },
      ),
      'ID_MISMATCH',
      '/data/id',
    );
  });

  it('기대 id와 같으면 통과한다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', id: 'mine' } },
      { expectedType: 'examples', expectedId: 'mine' },
    );
    expect(result.id).toBe('mine');
  });

  it('기대 id가 있는데 문서에 id가 없으면 통과한다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples' } },
      { expectedType: 'examples', expectedId: 'mine' },
    );
    expect(result.id).toBeUndefined();
  });

  it('클라이언트 생성 id를 기본적으로 거부한다', () => {
    expectJsonApiError(
      () => parseResourceInput({ data: { type: 'examples', id: 'c1' } }, { expectedType: 'examples' }),
      'CLIENT_GENERATED_ID_UNSUPPORTED',
      '/data/id',
    );
  });

  it('허용하면 클라이언트 생성 id를 받는다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', id: 'c1' } },
      { expectedType: 'examples', allowClientGeneratedId: true },
    );
    expect(result.id).toBe('c1');
  });

  it('id가 문자열이 아니면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () => parseResourceInput(
        { data: { type: 'examples', id: 1 } },
        { expectedType: 'examples', allowClientGeneratedId: true },
      ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/id',
    );
  });
});

describe('parseLinkageInput', () => {
  it('to-one linkage를 파싱한다', () => {
    const result = parseLinkageInput(
      { data: { type: 'categories', id: 'c1' } },
      { expectedType: 'categories', cardinality: 'one' },
    );
    expect(result).toEqual({ type: 'categories', id: 'c1' });
  });

  it('to-one null linkage는 관계 해제를 뜻한다', () => {
    const result = parseLinkageInput(
      { data: null },
      { expectedType: 'categories', cardinality: 'one' },
    );
    expect(result).toBeNull();
  });

  it('to-many linkage를 파싱한다', () => {
    const result = parseLinkageInput(
      { data: [{ type: 'tags', id: 't1' }, { type: 'tags', id: 't2' }] },
      { expectedType: 'tags', cardinality: 'many' },
    );
    expect(result).toEqual([{ type: 'tags', id: 't1' }, { type: 'tags', id: 't2' }]);
  });

  it('to-many 빈 배열은 전체 해제를 뜻한다', () => {
    const result = parseLinkageInput(
      { data: [] },
      { expectedType: 'tags', cardinality: 'many' },
    );
    expect(result).toEqual([]);
  });

  it('to-many에 null을 주면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () => parseLinkageInput({ data: null }, { expectedType: 'tags', cardinality: 'many' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data',
    );
  });

  it('to-one에 배열을 주면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () => parseLinkageInput({ data: [] }, { expectedType: 'categories', cardinality: 'one' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data',
    );
  });

  it('linkage type이 다르면 TYPE_MISMATCH', () => {
    expectJsonApiError(
      () => parseLinkageInput(
        { data: { type: 'articles', id: 'a1' } },
        { expectedType: 'categories', cardinality: 'one' },
      ),
      'TYPE_MISMATCH',
      '/data/type',
    );
  });

  it('to-many 항목의 type이 다르면 인덱스를 pointer에 담는다', () => {
    expectJsonApiError(
      () => parseLinkageInput(
        { data: [{ type: 'tags', id: 't1' }, { type: 'articles', id: 'a1' }] },
        { expectedType: 'tags', cardinality: 'many' },
      ),
      'TYPE_MISMATCH',
      '/data/1/type',
    );
  });

  it('linkage에 id가 없으면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () => parseLinkageInput(
        { data: { type: 'categories' } },
        { expectedType: 'categories', cardinality: 'one' },
      ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/id',
    );
  });

  it('data 멤버가 없으면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () => parseLinkageInput({}, { expectedType: 'tags', cardinality: 'many' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data',
    );
  });

  it('본문이 객체가 아니면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () => parseLinkageInput(null, { expectedType: 'tags', cardinality: 'many' }),
      'INVALID_JSONAPI_DOCUMENT',
    );
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/jsonapi/document.spec.ts`
기대: `Cannot find module '../../src/app/jsonapi/document.js'`로 FAIL.

- [ ] **Step 3: 구현 작성**

`src/app/jsonapi/document.ts`:

```ts
import { JsonApiError } from './errors.js';

/**
 * JSON:API 요청 문서의 구조 판정.
 *
 * 이 파일은 "본문이 JSON:API 문서인가"만 본다. 필드값이 도메인 규칙에 맞는지는
 * 보지 않는다 — 그것은 쓰기 스키마(class-validator)의 몫이고, 오류 코드도
 * `VALIDATION_ERROR`로 갈라진다. 두 책임을 한 곳에 두면 400과 422의 경계가 흐려진다.
 */

/** JSON:API 자원 식별자. linkage의 최소 단위다. */
export interface ResourceIdentifier {
  readonly type: string;
  readonly id: string;
}

/** 자원 문서의 `relationships` 한 항목. */
export interface RelationshipInput {
  readonly data: ResourceIdentifier | readonly ResourceIdentifier[] | null;
}

/** 파싱을 마친 자원 입력. */
export interface ParsedResourceInput {
  readonly type: string;
  readonly id: string | undefined;
  readonly attributes: Record<string, unknown>;
  readonly relationships: Record<string, RelationshipInput>;
  /**
   * 요청이 실제로 보낸 attribute 키.
   *
   * PATCH가 "보내지 않은 필드"와 "`null`로 보낸 필드"를 구분하는 근거다.
   * `plainToInstance`는 이 정보를 지우므로 변환 전에 잡아 둔다.
   */
  readonly presentKeys: ReadonlySet<string>;
}

/** `parseResourceInput` 옵션. */
export interface ParseResourceOptions {
  /** 이 라우트가 받는 자원 타입. 문서의 `type`과 다르면 `TYPE_MISMATCH`. */
  readonly expectedType: string;
  /** 경로에서 온 id. 문서가 id를 보냈고 이 값과 다르면 `ID_MISMATCH`. */
  readonly expectedId?: string;
  /** 클라이언트가 생성한 id를 받을지. 기본은 거부. */
  readonly allowClientGeneratedId?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidDocument(pointer?: string, detail?: string): JsonApiError {
  return new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
    source: pointer === undefined ? undefined : { pointer },
    detail,
  });
}

/** 하나의 linkage 항목을 검사한다. */
function readIdentifier(
  value: unknown,
  expectedType: string,
  pointer: string,
): ResourceIdentifier {
  if (!isPlainObject(value)) {
    throw invalidDocument(pointer, 'resource identifier must be an object');
  }
  const type = value.type;
  if (typeof type !== 'string' || type === '') {
    throw invalidDocument(`${pointer}/type`, 'resource identifier requires a type');
  }
  if (type !== expectedType) {
    throw new JsonApiError('TYPE_MISMATCH', {
      source: { pointer: `${pointer}/type` },
      detail: `expected type "${expectedType}" but received "${type}"`,
    });
  }
  const id = value.id;
  if (typeof id !== 'string' || id === '') {
    throw invalidDocument(`${pointer}/id`, 'resource identifier requires an id');
  }
  return { type, id };
}

/**
 * 자원 생성·수정 요청 문서를 파싱한다.
 *
 * 성공하면 attributes와 relationships를 원본 그대로 넘긴다. 값 검증은 하지 않는다.
 */
export function parseResourceInput(
  body: unknown,
  options: ParseResourceOptions,
): ParsedResourceInput {
  if (!isPlainObject(body)) {
    throw invalidDocument(undefined, 'request body must be a JSON object');
  }

  const data = body.data;
  if (!isPlainObject(data)) {
    throw invalidDocument('/data', 'the document requires a single resource object in "data"');
  }

  const type = data.type;
  if (typeof type !== 'string' || type === '') {
    throw invalidDocument('/data/type', 'the resource object requires a type');
  }
  if (type !== options.expectedType) {
    throw new JsonApiError('TYPE_MISMATCH', {
      source: { pointer: '/data/type' },
      detail: `expected type "${options.expectedType}" but received "${type}"`,
    });
  }

  let id: string | undefined;
  if (data.id !== undefined) {
    if (typeof data.id !== 'string' || data.id === '') {
      throw invalidDocument('/data/id', 'the resource id must be a non-empty string');
    }
    id = data.id;
    if (options.expectedId !== undefined) {
      if (id !== options.expectedId) {
        throw new JsonApiError('ID_MISMATCH', {
          source: { pointer: '/data/id' },
          detail: `expected id "${options.expectedId}" but received "${id}"`,
        });
      }
    } else if (options.allowClientGeneratedId !== true) {
      throw new JsonApiError('CLIENT_GENERATED_ID_UNSUPPORTED', {
        source: { pointer: '/data/id' },
      });
    }
  }

  let attributes: Record<string, unknown> = {};
  if (data.attributes !== undefined) {
    if (!isPlainObject(data.attributes)) {
      throw invalidDocument('/data/attributes', '"attributes" must be an object');
    }
    attributes = data.attributes;
  }

  const relationships: Record<string, RelationshipInput> = {};
  if (data.relationships !== undefined) {
    if (!isPlainObject(data.relationships)) {
      throw invalidDocument('/data/relationships', '"relationships" must be an object');
    }
    for (const [name, value] of Object.entries(data.relationships)) {
      if (!isPlainObject(value) || !('data' in value)) {
        throw invalidDocument(
          `/data/relationships/${name}`,
          'a relationship requires a "data" member',
        );
      }
      relationships[name] = { data: value.data as RelationshipInput['data'] };
    }
  }

  return {
    type,
    id,
    attributes,
    relationships,
    presentKeys: new Set(Object.keys(attributes)),
  };
}

/** `parseLinkageInput` 옵션. */
export interface ParseLinkageOptions {
  readonly expectedType: string;
  readonly cardinality: 'one' | 'many';
}

/**
 * 관계 라우트의 linkage 문서를 파싱한다.
 *
 * to-one은 식별자 하나 또는 `null`(해제), to-many는 식별자 배열(빈 배열은 전체 해제)이다.
 * 내부 FK를 공개 입력으로 만들지 않기 위해 `ResourceIdentifier`만 받는다.
 */
export function parseLinkageInput(
  body: unknown,
  options: ParseLinkageOptions,
): ResourceIdentifier | ResourceIdentifier[] | null {
  if (!isPlainObject(body)) {
    throw invalidDocument(undefined, 'request body must be a JSON object');
  }
  if (!('data' in body)) {
    throw invalidDocument('/data', 'the document requires a "data" member');
  }

  const data = body.data;

  if (options.cardinality === 'one') {
    if (data === null) {
      return null;
    }
    if (Array.isArray(data)) {
      throw invalidDocument('/data', 'a to-one relationship requires a single resource identifier');
    }
    return readIdentifier(data, options.expectedType, '/data');
  }

  if (!Array.isArray(data)) {
    throw invalidDocument('/data', 'a to-many relationship requires an array of resource identifiers');
  }
  return data.map((entry, index) =>
    readIdentifier(entry, options.expectedType, `/data/${String(index)}`),
  );
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인**

실행: `pnpm test:quick -- test/jsonapi/document.spec.ts`
기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/jsonapi/document.ts test/jsonapi/document.spec.ts
git commit -m "feat(jsonapi): 요청 문서 구조 파싱과 linkage 검증 추가"
```

---

## Task 4: 미디어 타입 협상 가드

**Files:**
- Create: `src/app/jsonapi/negotiation.ts`
- Test: `test/jsonapi/negotiation.spec.ts`

**Interfaces:**
- Consumes: `JSONAPI_MEDIA_TYPE` from `./media-type.js` (Phase 0), `JsonApiError` from `./errors.js` (Task 1)
- Produces:
  - `class JsonApiNegotiationGuard implements CanActivate`
  - `const NEGOTIATE_ACCEPT_KEY: string` — 협상을 끌 때 쓰는 메타데이터 키
  - `function SkipJsonApiNegotiation(): MethodDecorator & ClassDecorator`
  - `function acceptsJsonApi(header: string | undefined): boolean` (내부 로직의 테스트 진입점으로 export)

**설계 근거:** 스펙 5.1이 요구하는 두 규칙 — `Accept`가 vendor 타입을 받아들이지 못하면 `406`, 본문이 있는 요청의 `Content-Type`이 vendor 타입이 아니면 `415`. JSON:API 1.1은 vendor 타입에 **미디어 타입 파라미터를 붙이면 안 된다**고 규정하므로(`ext`/`profile` 제외) 파라미터가 붙은 `Accept`는 거부한다.

`health` 컨트롤러는 협상 대상이 아니다. 가드를 전역이 아니라 컨트롤러 단위로 붙이고, 예외는 `@SkipJsonApiNegotiation()`으로 코드에 남긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/jsonapi/negotiation.spec.ts`:

```ts
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  JsonApiNegotiationGuard,
  acceptsJsonApi,
} from '../../src/app/jsonapi/negotiation.js';

interface FakeRequest {
  readonly method: string;
  readonly headers: Record<string, string | undefined>;
}

function contextFor(request: FakeRequest): ExecutionContext {
  // handler/controller는 호출마다 같은 객체여야 한다. Reflector가 메타데이터를 찾을 때
  // 매번 다른 객체를 받으면 조회가 성립하지 않는다.
  const handler = function handler(): void {};
  const controller = class Controller {};
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function guard(): JsonApiNegotiationGuard {
  return new JsonApiNegotiationGuard(new Reflector());
}

describe('acceptsJsonApi', () => {
  it('헤더가 없으면 허용한다', () => {
    expect(acceptsJsonApi(undefined)).toBe(true);
  });

  it('빈 헤더는 허용한다', () => {
    expect(acceptsJsonApi('')).toBe(true);
  });

  it('와일드카드를 허용한다', () => {
    expect(acceptsJsonApi('*/*')).toBe(true);
    expect(acceptsJsonApi('application/*')).toBe(true);
  });

  it('정확한 vendor 타입을 허용한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json')).toBe(true);
  });

  it('여러 후보 중 하나가 vendor 타입이면 허용한다', () => {
    expect(acceptsJsonApi('text/html, application/vnd.api+json')).toBe(true);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(acceptsJsonApi('Application/VND.api+JSON')).toBe(true);
  });

  it('공백을 무시한다', () => {
    expect(acceptsJsonApi('  application/vnd.api+json  ')).toBe(true);
  });

  it('일반 JSON만 받는 요청은 거부한다', () => {
    expect(acceptsJsonApi('application/json')).toBe(false);
  });

  it('무관한 타입은 거부한다', () => {
    expect(acceptsJsonApi('text/html')).toBe(false);
  });

  it('미디어 타입 파라미터가 붙으면 거부한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json; charset=utf-8')).toBe(false);
  });

  it('q 파라미터는 허용한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json;q=0.9')).toBe(true);
  });

  it('모든 후보에 파라미터가 붙으면 거부한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json;charset=utf-8, text/html')).toBe(false);
  });
});

describe('JsonApiNegotiationGuard', () => {
  it('GET에 vendor Accept면 통과한다', () => {
    const context = contextFor({
      method: 'GET',
      headers: { accept: 'application/vnd.api+json' },
    });
    expect(guard().canActivate(context)).toBe(true);
  });

  it('Accept가 맞지 않으면 NOT_ACCEPTABLE', () => {
    const context = contextFor({ method: 'GET', headers: { accept: 'text/html' } });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('NOT_ACCEPTABLE');
      expect(error.status).toBe(406);
      return;
    }
    throw new Error('expected NOT_ACCEPTABLE');
  });

  it('본문이 있는 요청에 vendor Content-Type이면 통과한다', () => {
    const context = contextFor({
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
      },
    });
    expect(guard().canActivate(context)).toBe(true);
  });

  it('Content-Type이 다르면 UNSUPPORTED_MEDIA_TYPE', () => {
    const context = contextFor({
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/json',
      },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(error.status).toBe(415);
      return;
    }
    throw new Error('expected UNSUPPORTED_MEDIA_TYPE');
  });

  it('Content-Type에 charset이 붙으면 거부한다', () => {
    const context = contextFor({
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json; charset=utf-8',
      },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      return;
    }
    throw new Error('expected UNSUPPORTED_MEDIA_TYPE');
  });

  it('본문 없는 메서드는 Content-Type을 보지 않는다', () => {
    for (const method of ['GET', 'HEAD', 'DELETE', 'OPTIONS']) {
      const context = contextFor({
        method,
        headers: { accept: 'application/vnd.api+json', 'content-type': 'text/plain' },
      });
      expect(guard().canActivate(context)).toBe(true);
    }
  });

  it('POST에 Content-Type이 아예 없으면 UNSUPPORTED_MEDIA_TYPE', () => {
    const context = contextFor({
      method: 'POST',
      headers: { accept: 'application/vnd.api+json' },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      return;
    }
    throw new Error('expected UNSUPPORTED_MEDIA_TYPE');
  });

  it('Accept 위반이 Content-Type 위반보다 먼저 판정된다', () => {
    const context = contextFor({
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'text/plain' },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('NOT_ACCEPTABLE');
      return;
    }
    throw new Error('expected NOT_ACCEPTABLE');
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/jsonapi/negotiation.spec.ts`
기대: `Cannot find module '../../src/app/jsonapi/negotiation.js'`로 FAIL.

- [ ] **Step 3: 구현 작성**

`src/app/jsonapi/negotiation.ts`:

```ts
import { Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JsonApiError } from './errors.js';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';

/**
 * JSON:API 미디어 타입 협상.
 *
 * JSON:API 1.1은 vendor 타입에 미디어 타입 파라미터를 붙이는 것을 금지한다
 * (`ext`와 `profile`만 예외). 따라서 `application/vnd.api+json; charset=utf-8`은
 * 규격 위반이고, 받아주면 클라이언트가 규격을 벗어난 채로 굳는다.
 *
 * `q`는 HTTP 협상 파라미터이지 미디어 타입 파라미터가 아니므로 허용한다.
 */

/** 협상을 끄는 메타데이터 키. */
export const NEGOTIATE_ACCEPT_KEY = 'jsonapi:skip-negotiation';

/**
 * 이 핸들러나 컨트롤러를 협상 대상에서 제외한다.
 *
 * `health`처럼 평문 JSON을 내는 라우트에 쓴다. 협상을 생략한다는 의도를 코드에 남기는 것이
 * 목적이므로, 가드를 아예 붙이지 않는 것보다 이 데코레이터를 선호한다.
 */
export function SkipJsonApiNegotiation(): MethodDecorator & ClassDecorator {
  return SetMetadata(NEGOTIATE_ACCEPT_KEY, true);
}

/** 본문을 실을 수 있는 메서드. 이때만 `Content-Type`을 본다. */
const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

function isJsonApiRange(range: string): boolean {
  const [mediaType, ...parameters] = range.split(';');
  const normalized = mediaType.trim().toLowerCase();

  if (normalized === '*/*' || normalized === 'application/*') {
    return true;
  }
  if (normalized !== JSONAPI_MEDIA_TYPE) {
    return false;
  }
  // vendor 타입에는 q 이외의 파라미터를 허용하지 않는다.
  return parameters.every((parameter) => {
    const key = parameter.split('=')[0]?.trim().toLowerCase();
    return key === undefined || key === '' || key === 'q';
  });
}

/** `Accept` 헤더가 JSON:API 응답을 받아들이는지 판정한다. */
export function acceptsJsonApi(header: string | undefined): boolean {
  if (header === undefined || header.trim() === '') {
    return true;
  }
  return header.split(',').some((range) => isJsonApiRange(range));
}

/** `Content-Type` 헤더가 정확히 vendor 타입인지 판정한다. */
function isJsonApiContentType(header: string | undefined): boolean {
  if (header === undefined) {
    return false;
  }
  const [mediaType, ...parameters] = header.split(';');
  if (mediaType.trim().toLowerCase() !== JSONAPI_MEDIA_TYPE) {
    return false;
  }
  return parameters.every((parameter) => parameter.trim() === '');
}

interface NegotiableRequest {
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

function headerValue(request: NegotiableRequest, name: string): string | undefined {
  const raw = request.headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

/**
 * 리소스 라우트의 `Accept`와 `Content-Type`을 검증한다.
 *
 * `Accept` 위반을 먼저 판정한다. 클라이언트가 우리 응답을 읽지 못하는 상황이
 * 요청 본문 형식보다 앞선 문제이기 때문이다.
 */
@Injectable()
export class JsonApiNegotiationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(NEGOTIATE_ACCEPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<NegotiableRequest>();

    if (!acceptsJsonApi(headerValue(request, 'accept'))) {
      throw new JsonApiError('NOT_ACCEPTABLE', {
        detail: `this endpoint only produces ${JSONAPI_MEDIA_TYPE}`,
      });
    }

    if (BODY_METHODS.has(request.method.toUpperCase())) {
      if (!isJsonApiContentType(headerValue(request, 'content-type'))) {
        throw new JsonApiError('UNSUPPORTED_MEDIA_TYPE', {
          detail: `this endpoint only consumes ${JSONAPI_MEDIA_TYPE} without media type parameters`,
        });
      }
    }

    return true;
  }
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인**

실행: `pnpm test:quick -- test/jsonapi/negotiation.spec.ts`
기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/jsonapi/negotiation.ts test/jsonapi/negotiation.spec.ts
git commit -m "feat(jsonapi): Accept/Content-Type 협상 가드 추가"
```

---
## Task 5: 예외 필터와 응답 계약

**Files:**
- Create: `src/app/jsonapi/exception-filter.ts`
- Create: `src/app/jsonapi/response.ts`
- Modify: `src/config/app.module.ts` — 전역 필터·인터셉터 등록
- Modify: `src/app/controllers/health.controller.ts` — 협상·응답 계약에서 제외한다는 의도 표기
- Test: `test/jsonapi/exception-filter.spec.ts`
- Test: `test/jsonapi/response.spec.ts`

**Interfaces:**
- Consumes: `JsonApiError`, `ERROR_CATALOG`, `catalogEntry` (Task 1); `resolveLanguage`, `SupportedLanguage` (Task 2); `SkipJsonApiNegotiation`, `NEGOTIATE_ACCEPT_KEY` (Task 4); `JSONAPI_MEDIA_TYPE` (Phase 0)
- Produces:
  - `interface JsonApiErrorObject { readonly code: string; readonly status: string; readonly title: string; readonly detail?: string; readonly source?: JsonApiErrorSource; readonly meta?: Record<string, unknown> }`
  - `interface ErrorDocument { readonly errors: readonly JsonApiErrorObject[] }`
  - `function buildErrorDocument(errors: readonly JsonApiError[], language: SupportedLanguage): ErrorDocument`
  - `class JsonApiExceptionFilter implements ExceptionFilter`
  - `class JsonApiResponseInterceptor implements NestInterceptor`

**설계 근거 (의도적 비대칭):** 예외 필터는 **전역**이고 인터셉터는 **협상 대상 라우트에만** 적용된다. 스펙 5.2가 "Nest 기본 오류 형식은 외부로 나가지 않는다"고 못박으므로 오류 형식은 저장소 전체에서 하나여야 한다 — `/health`의 404도 JSON:API 오류 문서로 나간다. 반면 성공 응답 형식은 라우트마다 다르다(`/health`는 평문 JSON). 이 비대칭은 의도적이며 두 파일의 주석에 근거를 남긴다.

- [ ] **Step 1: 실패하는 테스트 작성 (예외 필터)**

`test/jsonapi/exception-filter.spec.ts`:

```ts
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ERROR_CATALOG, JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  JsonApiExceptionFilter,
  buildErrorDocument,
} from '../../src/app/jsonapi/exception-filter.js';
import { JSONAPI_MEDIA_TYPE } from '../../src/app/jsonapi/media-type.js';

interface CapturedResponse {
  status?: number;
  headers: Record<string, string>;
  body?: unknown;
}

function hostFor(acceptLanguage?: string): { host: ArgumentsHost; captured: CapturedResponse } {
  const captured: CapturedResponse = { headers: {} };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const request = { headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage } };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('buildErrorDocument', () => {
  it('오류 하나를 문서로 만든다', () => {
    const document = buildErrorDocument([new JsonApiError('RESOURCE_NOT_FOUND')], 'en');
    expect(document.errors).toHaveLength(1);
    expect(document.errors[0].code).toBe('RESOURCE_NOT_FOUND');
    expect(document.errors[0].status).toBe('404');
    expect(document.errors[0].title).toBe(ERROR_CATALOG.RESOURCE_NOT_FOUND.en);
  });

  it('status를 문자열로 담는다 (JSON:API 규격)', () => {
    const document = buildErrorDocument([new JsonApiError('VALIDATION_ERROR')], 'ko');
    expect(typeof document.errors[0].status).toBe('string');
    expect(document.errors[0].status).toBe('422');
  });

  it('언어에 따라 title이 달라진다', () => {
    const ko = buildErrorDocument([new JsonApiError('INVALID_SORT')], 'ko');
    const en = buildErrorDocument([new JsonApiError('INVALID_SORT')], 'en');
    expect(ko.errors[0].title).toBe(ERROR_CATALOG.INVALID_SORT.ko);
    expect(en.errors[0].title).toBe(ERROR_CATALOG.INVALID_SORT.en);
  });

  it('source pointer를 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/title' } })],
      'ko',
    );
    expect(document.errors[0].source).toEqual({ pointer: '/data/attributes/title' });
  });

  it('source parameter를 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('INVALID_FILTER', { source: { parameter: 'filter[x]' } })],
      'ko',
    );
    expect(document.errors[0].source).toEqual({ parameter: 'filter[x]' });
  });

  it('detail을 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('INVALID_PAGE', { detail: 'page[size] must be <= 100' })],
      'ko',
    );
    expect(document.errors[0].detail).toBe('page[size] must be <= 100');
  });

  it('detail이 없으면 멤버를 생략한다', () => {
    const document = buildErrorDocument([new JsonApiError('RESOURCE_NOT_FOUND')], 'ko');
    expect('detail' in document.errors[0]).toBe(false);
  });

  it('source가 없으면 멤버를 생략한다', () => {
    const document = buildErrorDocument([new JsonApiError('RESOURCE_NOT_FOUND')], 'ko');
    expect('source' in document.errors[0]).toBe(false);
  });

  it('meta를 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('RESOURCE_CONFLICT', { meta: { id: 'x' } })],
      'ko',
    );
    expect(document.errors[0].meta).toEqual({ id: 'x' });
  });

  it('오류 여러 개를 한 문서에 담는다', () => {
    const document = buildErrorDocument(
      [
        new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/a' } }),
        new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/b' } }),
      ],
      'ko',
    );
    expect(document.errors).toHaveLength(2);
  });
});

describe('JsonApiExceptionFilter', () => {
  const filter = new JsonApiExceptionFilter();

  it('JsonApiError의 status와 코드를 그대로 낸다', () => {
    const { host, captured } = hostFor();
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    expect(captured.status).toBe(404);
    expect((captured.body as { errors: { code: string }[] }).errors[0].code).toBe('RESOURCE_NOT_FOUND');
  });

  it('vendor Content-Type으로 응답한다', () => {
    const { host, captured } = hostFor();
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    expect(captured.headers['content-type']).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('Accept-Language를 따라 ko 메시지를 낸다', () => {
    const { host, captured } = hostFor('ko');
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    expect((captured.body as { errors: { title: string }[] }).errors[0].title).toBe(
      ERROR_CATALOG.RESOURCE_NOT_FOUND.ko,
    );
  });

  it('Accept-Language를 따라 en 메시지를 낸다', () => {
    const { host, captured } = hostFor('en');
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    expect((captured.body as { errors: { title: string }[] }).errors[0].title).toBe(
      ERROR_CATALOG.RESOURCE_NOT_FOUND.en,
    );
  });

  it('헤더가 없으면 ko가 기본이다', () => {
    const { host, captured } = hostFor();
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    expect((captured.body as { errors: { title: string }[] }).errors[0].title).toBe(
      ERROR_CATALOG.RESOURCE_NOT_FOUND.ko,
    );
  });

  it('Nest HttpException을 HTTP_ERROR로 감싸고 status를 유지한다', () => {
    const { host, captured } = hostFor();
    filter.catch(new NotFoundException(), host);
    expect(captured.status).toBe(404);
    const body = captured.body as { errors: { code: string; status: string }[] };
    expect(body.errors[0].code).toBe('HTTP_ERROR');
    expect(body.errors[0].status).toBe('404');
  });

  it('임의 status의 HttpException도 유지한다', () => {
    const { host, captured } = hostFor();
    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);
    expect(captured.status).toBe(418);
  });

  it('알 수 없는 오류는 INTERNAL_SERVER_ERROR 500이다', () => {
    const { host, captured } = hostFor();
    filter.catch(new Error('boom'), host);
    expect(captured.status).toBe(500);
    expect((captured.body as { errors: { code: string }[] }).errors[0].code).toBe(
      'INTERNAL_SERVER_ERROR',
    );
  });

  it('던져진 값이 Error가 아니어도 500으로 처리한다', () => {
    const { host, captured } = hostFor();
    filter.catch('문자열이 던져졌다', host);
    expect(captured.status).toBe(500);
    expect((captured.body as { errors: { code: string }[] }).errors[0].code).toBe(
      'INTERNAL_SERVER_ERROR',
    );
  });

  it('내부 오류 메시지를 응답에 노출하지 않는다', () => {
    const { host, captured } = hostFor();
    filter.catch(new Error('데이터베이스 비밀번호가 틀렸습니다'), host);
    expect(JSON.stringify(captured.body)).not.toContain('비밀번호');
  });
});
```

- [ ] **Step 2: 실패하는 테스트 작성 (응답 인터셉터)**

`test/jsonapi/response.spec.ts`:

```ts
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { JSONAPI_MEDIA_TYPE } from '../../src/app/jsonapi/media-type.js';
import { NEGOTIATE_ACCEPT_KEY } from '../../src/app/jsonapi/negotiation.js';
import { JsonApiResponseInterceptor } from '../../src/app/jsonapi/response.js';

function contextFor(skip: boolean): { context: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  };
  // handler/controller는 호출마다 같은 객체여야 한다. 화살표 안에서 새로 만들면
  // Reflect.defineMetadata가 버려지는 객체에 붙고 Reflector가 아무것도 못 찾는다.
  const handler = function handler(): void {};
  const controller = class Controller {};
  if (skip) {
    Reflect.defineMetadata(NEGOTIATE_ACCEPT_KEY, true, handler);
  }
  const context = {
    switchToHttp: () => ({ getResponse: () => response }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
  return { context, headers };
}

const nextOf = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('JsonApiResponseInterceptor', () => {
  it('협상 대상 라우트에 vendor Content-Type을 붙인다', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context, headers } = contextFor(false);
    await firstValueFrom(interceptor.intercept(context, nextOf({ data: null })));
    expect(headers['content-type']).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('제외된 라우트에는 붙이지 않는다', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context, headers } = contextFor(true);
    await firstValueFrom(interceptor.intercept(context, nextOf({ status: 'ok' })));
    expect(headers['content-type']).toBeUndefined();
  });

  it('본문을 그대로 통과시킨다', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context } = contextFor(false);
    const payload = { data: { type: 'examples', id: '1' } };
    await expect(firstValueFrom(interceptor.intercept(context, nextOf(payload)))).resolves.toBe(
      payload,
    );
  });

  it('undefined 본문도 통과시킨다 (204 응답)', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context } = contextFor(false);
    await expect(
      firstValueFrom(interceptor.intercept(context, nextOf(undefined))),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: 두 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/jsonapi/exception-filter.spec.ts test/jsonapi/response.spec.ts`
기대: 두 파일 모두 `Cannot find module`로 FAIL.

- [ ] **Step 4: 예외 필터 구현**

`src/app/jsonapi/exception-filter.ts`:

```ts
import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ERROR_CATALOG, JsonApiError } from './errors.js';
import type { JsonApiErrorSource } from './errors.js';
import type { SupportedLanguage } from './language.js';
import { resolveLanguage } from './language.js';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';

/**
 * 모든 오류를 JSON:API 오류 문서로 변환하는 전역 필터.
 *
 * **전역인 이유**: 스펙 5.2가 "Nest 기본 오류 형식은 외부로 나가지 않는다"고 정한다.
 * 오류 형식은 저장소 전체에서 하나여야 하므로 `/health`의 404도 이 필터를 지난다.
 * 성공 응답 형식은 라우트마다 다르므로(`response.ts` 참고) 인터셉터는 전역이 아니다.
 * 이 비대칭은 의도적이다.
 *
 * 알 수 없는 오류의 메시지는 절대 응답에 싣지 않는다. 스택 트레이스와 내부 메시지는
 * 정보 노출 경로이고, 클라이언트가 분기에 쓸 수 있는 것은 `code`뿐이다.
 */

/** JSON:API 오류 객체. */
export interface JsonApiErrorObject {
  readonly code: string;
  /** JSON:API는 status를 문자열로 요구한다. */
  readonly status: string;
  readonly title: string;
  readonly detail?: string;
  readonly source?: JsonApiErrorSource;
  readonly meta?: Record<string, unknown>;
}

/** JSON:API 오류 문서. */
export interface ErrorDocument {
  readonly errors: readonly JsonApiErrorObject[];
}

/** `JsonApiError` 목록을 지정한 언어의 오류 문서로 만든다. */
export function buildErrorDocument(
  errors: readonly JsonApiError[],
  language: SupportedLanguage,
): ErrorDocument {
  return {
    errors: errors.map((error) => {
      const entry = ERROR_CATALOG[error.code];
      const object: {
        code: string;
        status: string;
        title: string;
        detail?: string;
        source?: JsonApiErrorSource;
        meta?: Record<string, unknown>;
      } = {
        code: error.code,
        status: String(error.status),
        title: language === 'ko' ? entry.ko : entry.en,
      };
      if (error.detail !== undefined) {
        object.detail = error.detail;
      }
      if (error.source !== undefined) {
        object.source = error.source;
      }
      if (error.meta !== undefined) {
        object.meta = error.meta;
      }
      return object;
    }),
  };
}

interface LanguageAwareRequest {
  readonly headers: Record<string, string | string[] | undefined>;
}

interface JsonApiResponse {
  status(code: number): JsonApiResponse;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

/** 던져진 값을 `JsonApiError`로 정규화한다. */
function normalize(exception: unknown): JsonApiError {
  if (exception instanceof JsonApiError) {
    return exception;
  }
  if (exception instanceof HttpException) {
    return new JsonApiError('HTTP_ERROR', { status: exception.getStatus() });
  }
  return new JsonApiError('INTERNAL_SERVER_ERROR');
}

@Catch()
export class JsonApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<JsonApiResponse>();
    const request = http.getRequest<LanguageAwareRequest>();

    const raw = request.headers['accept-language'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const language = resolveLanguage(header);

    const error = normalize(exception);
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    response.status(error.status).json(buildErrorDocument([error], language));
  }
}
```

- [ ] **Step 5: 응답 인터셉터 구현**

`src/app/jsonapi/response.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';
import { NEGOTIATE_ACCEPT_KEY } from './negotiation.js';

/**
 * 성공 응답에 vendor `Content-Type`을 붙인다.
 *
 * **전역이 아닌 이유**: 성공 응답 형식은 라우트마다 다르다. `/health`는 평문 JSON을
 * 내므로 `@SkipJsonApiNegotiation()`으로 제외한다. 오류 형식은 전 저장소가 하나이므로
 * 예외 필터는 전역이다(`exception-filter.ts` 참고). 이 비대칭은 의도적이다.
 *
 * 협상 가드와 같은 메타데이터 키를 읽는다. "이 라우트는 JSON:API가 아니다"라는 선언이
 * 요청과 응답 양쪽에 같은 뜻으로 적용되어야 하므로 키를 나누지 않는다.
 */
@Injectable()
export class JsonApiResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(NEGOTIATE_ACCEPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip !== true) {
      context
        .switchToHttp()
        .getResponse<{ setHeader(name: string, value: string): unknown }>()
        .setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    }
    return next.handle();
  }
}
```

- [ ] **Step 6: 조립 지점에 등록**

`src/config/app.module.ts`를 통째로 아래 내용으로 바꾼다:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { JsonApiExceptionFilter } from '../app/jsonapi/exception-filter.js';
import { JsonApiResponseInterceptor } from '../app/jsonapi/response.js';
import { RoutesModule } from './routes.module.js';

/**
 * 애플리케이션 루트 모듈. 전역 미들웨어와 필터는 여기에서 등록 순서까지 검토한다.
 *
 * 예외 필터는 전역이고 응답 인터셉터는 라우트별로 꺼진다. 근거는 두 파일의 주석에 있다.
 */
@Module({
  imports: [RoutesModule],
  providers: [
    { provide: APP_FILTER, useClass: JsonApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: JsonApiResponseInterceptor },
  ],
})
export class AppModule {}
```

`src/app/controllers/health.controller.ts`에서 클래스 데코레이터를 아래처럼 고친다 (import 한 줄 추가, 데코레이터 한 줄 추가, 주석의 Phase 1 문구 갱신):

```ts
import { Controller, Get } from '@nestjs/common';
import { SkipJsonApiNegotiation } from '../jsonapi/negotiation.js';

/** 상태 확인 응답. */
export interface HealthStatus {
  readonly status: string;
}

/**
 * 상태 확인 컨트롤러.
 *
 * JSON:API 협상 대상이 아니다. vendor 미디어 타입 없이 평문 JSON을 반환한다.
 * 이 의도를 `@SkipJsonApiNegotiation()`으로 코드에 남긴다 — 가드를 붙이지 않는 것과
 * 결과는 같지만, 빠뜨린 것인지 뺀 것인지가 드러난다.
 *
 * liveness는 어떤 외부 자원도 해석하지 않는다.
 * readiness의 데이터베이스 확인은 Task 9에서 추가한다.
 */
@SkipJsonApiNegotiation()
@Controller('health')
export class HealthController {
  @Get('live')
  live(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): HealthStatus {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 7: HTTP 수준 회귀 테스트 추가**

`test/health.controller.spec.ts`의 `describe` 블록 안, 마지막 `it` 뒤에 아래를 추가한다:

```ts
  it('health 응답에는 vendor Content-Type을 붙이지 않는다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['content-type']).not.toContain('vnd.api+json');
  });

  it('없는 경로는 JSON:API 오류 문서로 응답한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/nope').expect(404);
    expect(response.headers['content-type']).toContain('application/vnd.api+json');
    const body = response.body as { errors: { code: string; status: string }[] };
    expect(body.errors[0].code).toBe('HTTP_ERROR');
    expect(body.errors[0].status).toBe('404');
  });

  it('Accept-Language: en 이면 오류 title이 영어다', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/nope')
      .set('Accept-Language', 'en')
      .expect(404);
    const body = response.body as { errors: { title: string }[] };
    expect(body.errors[0].title).toBe(ERROR_CATALOG.HTTP_ERROR.en);
  });

  it('Accept-Language가 없으면 오류 title이 한국어다', async () => {
    const response = await request(app.getHttpServer()).get('/health/nope').expect(404);
    const body = response.body as { errors: { title: string }[] };
    expect(body.errors[0].title).toBe(ERROR_CATALOG.HTTP_ERROR.ko);
  });
```

같은 파일 상단 import에 아래를 추가한다:

```ts
import { ERROR_CATALOG } from '../src/app/jsonapi/errors.js';
```

- [ ] **Step 8: 테스트를 돌려 통과를 확인**

실행: `pnpm test:quick`
기대: 모든 스위트 PASS. 특히 `test/health.controller.spec.ts`의 새 4개와 `test/config/openapi.spec.ts`, `test/config/routes.module.spec.ts`가 회귀하지 않았는지 확인한다.

`test/config/openapi.spec.ts`가 깨지면 원인은 인터셉터가 `/api/schema` 응답에도 vendor `Content-Type`을 붙였기 때문이다. Swagger 라우트는 Nest 컨트롤러가 아니라 Express 미들웨어로 등록되므로 인터셉터를 지나지 않는 것이 정상이다 — 깨진다면 그 사실을 리포트에 적고 컨트롤러에서 해결하지 말고 보고한다.

- [ ] **Step 9: 커밋**

```bash
git add src/app/jsonapi/exception-filter.ts src/app/jsonapi/response.ts \
        src/config/app.module.ts src/app/controllers/health.controller.ts \
        test/jsonapi/exception-filter.spec.ts test/jsonapi/response.spec.ts \
        test/health.controller.spec.ts
git commit -m "feat(jsonapi): 전역 예외 필터와 응답 Content-Type 계약 추가"
```

---

## Task 6: 데이터베이스 설정

**Files:**
- Modify: `src/config/settings.ts` — `DatabaseSettings`와 `loadDatabaseSettings` 추가
- Test: `test/config/settings.spec.ts` — 새 로더의 테스트 추가

**Interfaces:**
- Consumes: `requireEnv`, `optionalInteger`, `SettingsError` (Phase 0, 같은 파일)
- Produces:
  - `interface DatabaseSettings { readonly url: string; readonly poolMax: number; readonly idleTimeoutMs: number; readonly connectionTimeoutMs: number }`
  - `function loadDatabaseSettings(env?: NodeJS.ProcessEnv): DatabaseSettings`

**설계 근거:** 스펙 12가 정한 변수와 기본값을 그대로 옮긴다. `DB_POOL_MAX`는 **1 이상**이어야 한다 — 0이면 커넥션을 못 얻어 모든 질의가 영구히 대기하고, 그 증상은 설정 오류처럼 보이지 않는다. `optionalNonNegativeInteger`는 0을 통과시키므로 여기서는 쓰지 않고 별도 하한 검사를 둔다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/config/settings.spec.ts` 파일 끝에 아래 `describe`를 추가한다:

```ts
describe('loadDatabaseSettings', () => {
  const url = 'postgres://user:pass@localhost:5432/app';

  it('DATABASE_URL이 없으면 변수 이름이 담긴 오류', () => {
    expect(() => loadDatabaseSettings({})).toThrow(SettingsError);
    expect(() => loadDatabaseSettings({})).toThrow('DATABASE_URL is required');
  });

  it('DATABASE_URL이 공백뿐이면 거부한다', () => {
    expect(() => loadDatabaseSettings({ DATABASE_URL: '   ' })).toThrow('DATABASE_URL is required');
  });

  it('기본값을 스펙대로 적용한다', () => {
    const settings = loadDatabaseSettings({ DATABASE_URL: url });
    expect(settings.url).toBe(url);
    expect(settings.poolMax).toBe(10);
    expect(settings.idleTimeoutMs).toBe(30000);
    expect(settings.connectionTimeoutMs).toBe(30000);
  });

  it('DB_POOL_MAX를 읽는다', () => {
    expect(loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: '25' }).poolMax).toBe(25);
  });

  it('DB_POOL_MAX가 정수가 아니면 거부한다', () => {
    expect(() => loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: 'x' })).toThrow(
      'DB_POOL_MAX must be an integer',
    );
  });

  it('DB_POOL_MAX가 0 이하면 거부한다', () => {
    expect(() => loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: '0' })).toThrow(
      'DB_POOL_MAX must be at least 1',
    );
    expect(() => loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: '-1' })).toThrow(
      'DB_POOL_MAX must be at least 1',
    );
  });

  it('타임아웃을 읽는다', () => {
    const settings = loadDatabaseSettings({
      DATABASE_URL: url,
      DB_POOL_IDLE_TIMEOUT_MS: '1000',
      DB_POOL_CONNECTION_TIMEOUT_MS: '2000',
    });
    expect(settings.idleTimeoutMs).toBe(1000);
    expect(settings.connectionTimeoutMs).toBe(2000);
  });

  it('타임아웃이 음수면 거부한다', () => {
    expect(() =>
      loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_IDLE_TIMEOUT_MS: '-1' }),
    ).toThrow('DB_POOL_IDLE_TIMEOUT_MS must be non-negative');
    expect(() =>
      loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_CONNECTION_TIMEOUT_MS: '-1' }),
    ).toThrow('DB_POOL_CONNECTION_TIMEOUT_MS must be non-negative');
  });
});
```

같은 파일 상단의 import 목록에 `loadDatabaseSettings`를 추가한다 (`SettingsError`는 이미 import되어 있다).

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/config/settings.spec.ts`
기대: `loadDatabaseSettings is not a function` 또는 import 오류로 FAIL.

- [ ] **Step 3: 구현 작성**

`src/config/settings.ts` 파일 끝에 아래를 추가한다 (기존 내용은 건드리지 않는다):

```ts
/** 데이터베이스 접속과 커넥션 풀 설정. */
export interface DatabaseSettings {
  readonly url: string;
  readonly poolMax: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
}

/**
 * 데이터베이스 설정을 환경에서 읽는다.
 *
 * `DB_POOL_MAX`는 1 이상이어야 한다. 0을 허용하면 커넥션을 영원히 얻지 못해 모든
 * 질의가 조용히 매달리는데, 그 증상은 설정 오류처럼 보이지 않아 진단이 오래 걸린다.
 * 그래서 `optionalNonNegativeInteger`(0을 통과시킨다)를 쓰지 않고 하한을 따로 검사한다.
 */
export function loadDatabaseSettings(env: NodeJS.ProcessEnv = process.env): DatabaseSettings {
  const poolMax = optionalInteger('DB_POOL_MAX', 10, env);
  if (poolMax < 1) {
    throw new SettingsError('DB_POOL_MAX must be at least 1');
  }

  return {
    url: requireEnv('DATABASE_URL', env),
    poolMax,
    idleTimeoutMs: optionalNonNegativeInteger('DB_POOL_IDLE_TIMEOUT_MS', 30000, env),
    connectionTimeoutMs: optionalNonNegativeInteger('DB_POOL_CONNECTION_TIMEOUT_MS', 30000, env),
  };
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인**

실행: `pnpm test:quick -- test/config/settings.spec.ts`
기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/config/settings.ts test/config/settings.spec.ts
git commit -m "feat(config): 데이터베이스 접속과 커넥션 풀 설정 로더 추가"
```

---
## Task 7: 의존성 설치, 엔티티, DataSource 조립

**Files:**
- Modify: `package.json` — TypeORM·pg·class-validator·class-transformer·@nestjs/typeorm 추가
- Create: `src/app/models/category.entity.ts`
- Create: `src/app/models/tag.entity.ts`
- Create: `src/app/models/example.entity.ts`
- Create: `src/app/models/index.ts`
- Create: `src/config/database.ts`
- Create: `src/config/data-source.ts`
- Test: `test/models/entities.spec.ts`

**Interfaces:**
- Consumes: `DatabaseSettings`, `loadDatabaseSettings` (Task 6)
- Produces:
  - `class Category` — `id`, `name`, `createdAt`, `updatedAt`, `examples`
  - `class Tag` — `id`, `name`, `createdAt`, `updatedAt`, `examples`
  - `class Example` — `id`, `title`, `body`, `status`, `publishedAt`, `createdAt`, `updatedAt`, `categoryId`, `category`, `tags`
  - `type ExampleStatus = 'draft' | 'published' | 'archived'`
  - `const EXAMPLE_STATUSES: readonly ExampleStatus[]`
  - `const ENTITIES: readonly Function[]` (from `src/app/models/index.ts`)
  - `function buildDataSourceOptions(settings: DatabaseSettings): DataSourceOptions` (from `src/config/database.ts`)
  - `const dataSource: DataSource` (default export from `src/config/data-source.ts`, TypeORM CLI 전용)

**설계 근거 (명시 등록):** 엔티티와 마이그레이션을 glob 경로(`src/**/*.entity.ts`)로 자동 탐색하지 않는다. 이 템플릿의 라우트 계약("배열에 없으면 존재하지 않는 것과 같다")을 영속 계층에도 똑같이 적용한다. ESM + `tsc` 빌드 조합에서 glob은 `dist/`와 `src/` 경로가 갈라지는 흔한 실패원이기도 하다.

**설계 근거 (인덱스):** 스펙 8.3이 "모든 정렬에 `id ASC`가 덧붙으므로 유용한 인덱스는 `(<column>, id)`"라고 정한다. Phase 3의 기본 정렬이 `createdAt DESC`가 될 것이므로 `(created_at, id)`를 지금 만든다. `title` 인덱스는 Phase 3에서 `QueryPolicy`에 정렬을 열 때 함께 판단한다.

- [ ] **Step 1: 의존성 설치**

```bash
pnpm add typeorm pg @nestjs/typeorm class-validator class-transformer
pnpm add -D @types/pg
```

설치 후 `package.json`의 `dependencies`에 정확한 버전이 고정되었는지 확인한다. **버전 확인 규칙:** 스펙이 정한 하한은 TypeORM `1.1.0`, pg `8.x`, `@nestjs/typeorm` `12.x`, class-validator `0.15.x`, class-transformer `0.5.x`다. pnpm이 24시간 미만 배포 버전을 거부하면(`minimumReleaseAge`) 그 직전 버전으로 내려 고정하고, 어떤 버전을 왜 골랐는지 리포트에 적는다.

설치 결과를 확인:

```bash
pnpm typecheck
```

기대: exit 0 (아직 새 소스가 없으므로 통과해야 한다).

- [ ] **Step 2: 실패하는 테스트 작성**

`test/models/entities.spec.ts`:

```ts
import { getMetadataArgsStorage } from 'typeorm';
import { Category } from '../../src/app/models/category.entity.js';
import { Example, EXAMPLE_STATUSES } from '../../src/app/models/example.entity.js';
import { ENTITIES } from '../../src/app/models/index.js';
import { Tag } from '../../src/app/models/tag.entity.js';

function tableFor(target: Function): string {
  const table = getMetadataArgsStorage().tables.find((entry) => entry.target === target);
  if (table?.name === undefined) {
    throw new Error(`no table metadata for ${target.name}`);
  }
  return table.name;
}

function columnNames(target: Function): string[] {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.options.name ?? column.propertyName)
    .sort();
}

describe('엔티티 등록', () => {
  it('ENTITIES가 세 엔티티를 명시적으로 담는다', () => {
    expect(ENTITIES).toHaveLength(3);
    expect(ENTITIES).toContain(Example);
    expect(ENTITIES).toContain(Category);
    expect(ENTITIES).toContain(Tag);
  });
});

describe('테이블 이름', () => {
  it('snake_case 복수형을 쓴다', () => {
    expect(tableFor(Example)).toBe('examples');
    expect(tableFor(Category)).toBe('categories');
    expect(tableFor(Tag)).toBe('tags');
  });
});

describe('Example 엔티티', () => {
  it('스펙이 정한 컬럼을 가진다', () => {
    expect(columnNames(Example)).toEqual(
      ['body', 'category_id', 'created_at', 'id', 'published_at', 'status', 'title', 'updated_at'].sort(),
    );
  });

  it('status 값 집합을 고정한다', () => {
    expect([...EXAMPLE_STATUSES].sort()).toEqual(['archived', 'draft', 'published']);
  });

  it('category to-one 관계를 선언한다', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (entry) => entry.target === Example && entry.propertyName === 'category',
    );
    expect(relation?.relationType).toBe('many-to-one');
  });

  it('tags to-many 관계를 선언한다', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (entry) => entry.target === Example && entry.propertyName === 'tags',
    );
    expect(relation?.relationType).toBe('many-to-many');
  });

  it('(created_at, id) 인덱스를 선언한다', () => {
    const indices = getMetadataArgsStorage().indices.filter((entry) => entry.target === Example);
    // `IndexMetadataArgs.columns`는 `string[]`와 선택자 함수의 유니온이다. 캐스트로
    // 지우면 함수형이 왔을 때를 조용히 넘기게 되므로, 실제 분기로 좁힌다.
    const columns = indices.map((entry) => {
      if (!Array.isArray(entry.columns)) {
        throw new Error('인덱스가 컬럼 배열이 아니라 선택자 함수로 선언되어 있다');
      }
      return entry.columns.join(',');
    });
    expect(columns).toContain('createdAt,id');
  });
});

describe('Category 엔티티', () => {
  it('스펙이 정한 컬럼을 가진다', () => {
    expect(columnNames(Category)).toEqual(['created_at', 'id', 'name', 'updated_at']);
  });
});

describe('Tag 엔티티', () => {
  it('스펙이 정한 컬럼을 가진다', () => {
    expect(columnNames(Tag)).toEqual(['created_at', 'id', 'name', 'updated_at']);
  });
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/models/entities.spec.ts`
기대: `Cannot find module`로 FAIL.

- [ ] **Step 4: `Category` 엔티티 작성**

`src/app/models/category.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Example } from './example.entity.js';

/**
 * Example의 분류. to-one 관계의 대상이다.
 *
 * 관계 반대편(`examples`)을 문자열 참조로 선언한 이유: `Example`을 값으로 import하면
 * `example.entity.ts`와 순환 import가 된다. TypeORM은 lazy 문자열 참조를 지원하므로
 * 타입만 `import type`으로 가져오고 관계 대상은 문자열로 준다.
 */
@Entity({ name: 'categories' })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 120, unique: true })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany('Example', 'category')
  examples?: Example[];
}
```

- [ ] **Step 5: `Tag` 엔티티 작성**

`src/app/models/tag.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Example } from './example.entity.js';

/**
 * Example에 붙는 라벨. to-many 관계의 대상이다.
 *
 * 조인 테이블의 소유자는 `Example` 쪽이다(`@JoinTable`이 거기 있다). 관계의 소유권을
 * 한쪽으로 고정해야 마이그레이션이 조인 테이블을 한 번만 만든다.
 */
@Entity({ name: 'tags' })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 60, unique: true })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToMany('Example', 'tags')
  examples?: Example[];
}
```

- [ ] **Step 6: `Example` 엔티티 작성**

`src/app/models/example.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from './category.entity.js';
import { Tag } from './tag.entity.js';

/** Example의 상태. 저장 형식은 PostgreSQL enum이다. */
export type ExampleStatus = 'draft' | 'published' | 'archived';

/** 허용되는 상태 값. 마이그레이션의 enum 정의와 이 배열이 같아야 한다. */
export const EXAMPLE_STATUSES: readonly ExampleStatus[] = ['draft', 'published', 'archived'];

/**
 * 이 템플릿의 견본 자원.
 *
 * to-one(`category`)과 to-many(`tags`)를 모두 갖는 이유는 Phase 4의 관계 라우트
 * 등록이 두 cardinality를 모두 다루는지 이 자원 하나로 검증하기 위해서다.
 *
 * `(created_at, id)` 인덱스: 스펙 8.3에 따라 모든 정렬 뒤에 `id ASC`가 tie breaker로
 * 덧붙으므로, 기본 정렬 `created_at DESC`가 실제로 인덱스를 타려면 두 컬럼이 함께
 * 있어야 한다. `title` 정렬 인덱스는 Phase 3에서 QueryPolicy에 정렬을 열 때 함께 판단한다.
 */
@Index(['createdAt', 'id'])
@Entity({ name: 'examples' })
export class Example {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'body', type: 'text', nullable: true })
  body!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: EXAMPLE_STATUSES,
    enumName: 'example_status',
    default: 'draft',
  })
  status!: ExampleStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  /**
   * 분류. `ON DELETE SET NULL` — 분류가 사라져도 Example은 남는다.
   * 분류 삭제가 본문 삭제로 번지면 데이터 손실이 조용히 일어난다.
   */
  @ManyToOne(() => Category, (category) => category.examples, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  /** 라벨. 조인 테이블의 소유자는 이쪽이다. */
  @ManyToMany(() => Tag, (tag) => tag.examples)
  @JoinTable({
    name: 'example_tags',
    joinColumn: { name: 'example_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags?: Tag[];
}
```

- [ ] **Step 7: 엔티티 등록 목록 작성**

`src/app/models/index.ts`:

```ts
import { Category } from './category.entity.js';
import { Example } from './example.entity.js';
import { Tag } from './tag.entity.js';

export { Category } from './category.entity.js';
export { Example, EXAMPLE_STATUSES } from './example.entity.js';
export type { ExampleStatus } from './example.entity.js';
export { Tag } from './tag.entity.js';

/**
 * DataSource에 등록하는 엔티티의 유일한 목록.
 *
 * glob 경로(`src/**\/*.entity.ts`)로 자동 탐색하지 않는다. 라우트 등록과 같은 계약이다 —
 * 이 배열에 없는 엔티티는 존재하지 않는 것과 같다. ESM + tsc 빌드에서 glob은 `src/`와
 * `dist/` 경로가 갈라지는 흔한 실패원이기도 하다.
 */
export const ENTITIES: readonly Function[] = [Example, Category, Tag];
```

- [ ] **Step 8: DataSource 옵션 조립**

`src/config/database.ts`:

```ts
import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from '../app/models/index.js';
import { MIGRATIONS } from '../db/migrations/index.js';
import type { DatabaseSettings } from './settings.js';

/**
 * `DataSource` 옵션을 조립한다.
 *
 * `synchronize`는 어떤 환경에서도 `false`다. 스키마 변경은 마이그레이션으로만 전달한다 —
 * `synchronize: true`는 개발 편의를 주는 대신 마이그레이션과 실제 스키마를 조용히
 * 어긋나게 만들고, 그 차이는 배포 시점에야 드러난다.
 *
 * `migrationsRun`도 `false`다. 마이그레이션 실행 시점은 배포 절차가 정할 일이지
 * 프로세스 시작이 정할 일이 아니다.
 */
export function buildDataSourceOptions(settings: DatabaseSettings): DataSourceOptions {
  return {
    type: 'postgres',
    url: settings.url,
    entities: [...ENTITIES],
    migrations: [...MIGRATIONS],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      max: settings.poolMax,
      idleTimeoutMillis: settings.idleTimeoutMs,
      connectionTimeoutMillis: settings.connectionTimeoutMs,
    },
  };
}
```

- [ ] **Step 9: CLI 전용 DataSource 작성**

`src/config/data-source.ts`:

```ts
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.js';
import { loadDatabaseSettings } from './settings.js';

/**
 * TypeORM CLI 전용 `DataSource`.
 *
 * `typeorm migration:run`은 이 파일을 직접 import해 default export를 읽는다.
 * 애플리케이션은 이 인스턴스를 쓰지 않는다 — Nest가 `TypeOrmModule`로 자기 것을 만든다.
 * 두 경로가 같은 `buildDataSourceOptions`를 지나므로 설정이 갈라지지 않는다.
 */
export default new DataSource(buildDataSourceOptions(loadDatabaseSettings()));
```

- [ ] **Step 10: 테스트를 돌려 통과를 확인**

실행: `pnpm test:quick -- test/models/entities.spec.ts`

기대: 전부 PASS. `src/db/migrations/index.ts`가 아직 없으므로 `database.ts`의 import가 깨진다 — Task 8에서 만든다. 이 스텝에서는 `entities.spec.ts`만 통과하면 되고, `pnpm typecheck`는 아직 실패해도 된다. **Task 8을 끝내기 전에는 커밋하지 않는다.**

- [ ] **Step 11: 커밋 보류**

이 태스크는 Task 8과 함께 커밋한다. `src/db/migrations/index.ts`가 없으면 `typecheck`가 깨지고, 깨진 상태를 커밋하면 이후 이분 탐색이 어려워진다. Task 8 Step 6에서 두 태스크의 파일을 함께 커밋한다.

---

## Task 8: 초기 마이그레이션

**Files:**
- Create: `src/db/migrations/20260829000000-create-example-schema.ts`
- Create: `src/db/migrations/index.ts`
- Test: `test/db/migration-naming.spec.ts`

**Interfaces:**
- Consumes: 없음 (마이그레이션은 순수 SQL)
- Produces:
  - `class CreateExampleSchema1787961600000 implements MigrationInterface`
  - `const MIGRATIONS: readonly Function[]` (from `src/db/migrations/index.ts`)

**타임스탬프 근거:** `1787961600000` = `2026-08-29T00:00:00Z`. 확인 방법: `node -e "console.log(new Date(1787961600000).toISOString())"` → `2026-08-29T00:00:00.000Z`. 파일명 `20260829000000`과 같은 시각을 가리킨다. **구현자는 이 값을 실제로 실행해 확인하고 리포트에 출력을 붙인다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`test/db/migration-naming.spec.ts`:

```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS } from '../../src/db/migrations/index.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations');
const FILE_PATTERN = /^(\d{14})-[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const CLASS_PATTERN = /^([A-Z][A-Za-z0-9]*?)(\d{13})$/;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .sort();
}

/** `20260829000000` → epoch millis (UTC로 해석). */
function fileTimestampToEpoch(stamp: string): number {
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const second = Number(stamp.slice(12, 14));
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

describe('마이그레이션 명명 규약', () => {
  it('마이그레이션이 하나 이상 있다', () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it('모든 파일명이 <14자리 UTC>-<kebab-name>.ts 형식이다', () => {
    for (const name of migrationFiles()) {
      expect(name).toMatch(FILE_PATTERN);
    }
  });

  it('모든 클래스명이 <PascalName><13자리 epoch millis> 형식이다', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.name).toMatch(CLASS_PATTERN);
    }
  });

  it('파일명 타임스탬프와 클래스명 타임스탬프가 같은 시각을 가리킨다', () => {
    const files = migrationFiles();
    expect(MIGRATIONS).toHaveLength(files.length);

    const classEpochs = MIGRATIONS.map((migration) => {
      const matched = CLASS_PATTERN.exec(migration.name);
      // `noUncheckedIndexedAccess` 아래에서 캡처 그룹은 `string | undefined`다.
      // 구조분해 후 명시적으로 좁힌다 — 캐스트나 `!`를 쓰지 않는다.
      const epoch = matched?.[2];
      if (epoch === undefined) {
        throw new Error(`bad migration class name: ${migration.name}`);
      }
      return Number(epoch);
    }).sort((a, b) => a - b);

    const fileEpochs = files
      .map((name) => {
        const matched = FILE_PATTERN.exec(name);
        const stamp = matched?.[1];
        if (stamp === undefined) {
          throw new Error(`bad migration file name: ${name}`);
        }
        return fileTimestampToEpoch(stamp);
      })
      .sort((a, b) => a - b);

    expect(classEpochs).toEqual(fileEpochs);
  });

  it('MIGRATIONS 배열이 디렉터리의 모든 마이그레이션을 담는다', () => {
    expect(MIGRATIONS).toHaveLength(migrationFiles().length);
  });

  it('모든 마이그레이션이 up과 down을 구현한다', () => {
    for (const migration of MIGRATIONS) {
      const proto = migration.prototype as Record<string, unknown>;
      expect(typeof proto.up).toBe('function');
      expect(typeof proto.down).toBe('function');
    }
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/db/migration-naming.spec.ts`
기대: `Cannot find module '../../src/db/migrations/index.js'`로 FAIL.

- [ ] **Step 3: 타임스탬프를 실제로 검증**

```bash
node -e "console.log(new Date(1787961600000).toISOString())"
```

기대 출력: `2026-08-29T00:00:00.000Z`

출력이 다르면 **계획의 값이 틀린 것이다.** 파일명·클래스명·이 스텝의 값을 실제 출력에 맞춰 함께 고치고, 무엇을 왜 바꿨는지 리포트에 적는다.

- [ ] **Step 4: 마이그레이션 작성**

`src/db/migrations/20260829000000-create-example-schema.ts`:

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Example·Category·Tag 초기 스키마.
 *
 * 클래스명 끝의 `1787961600000`은 `2026-08-29T00:00:00Z`의 epoch millis다. TypeORM은
 * 이 숫자를 파싱해 실행 순서를 정하므로, 파일명의 `20260829000000`과 같은 시각을
 * 가리켜야 한다. 어긋나면 파일 이름 순서와 실제 실행 순서가 갈라진다.
 *
 * `down()`은 `up()`이 만든 것을 역순으로 지운다. 되돌릴 수 없는 마이그레이션은
 * 받지 않으므로 비워 두지 않는다.
 */
export class CreateExampleSchema1787961600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TYPE "example_status" AS ENUM ('draft', 'published', 'archived')
    `);

    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_categories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_categories_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tags" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(60) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tags" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tags_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "examples" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying(200) NOT NULL,
        "body" text,
        "status" "example_status" NOT NULL DEFAULT 'draft',
        "published_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "category_id" uuid,
        CONSTRAINT "PK_examples" PRIMARY KEY ("id"),
        CONSTRAINT "FK_examples_category" FOREIGN KEY ("category_id")
          REFERENCES "categories" ("id") ON DELETE SET NULL
      )
    `);

    // 스펙 8.3: 모든 정렬에 id ASC가 tie breaker로 덧붙으므로 (컬럼, id)가 유용한 인덱스다.
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_created_at_id" ON "examples" ("created_at", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "example_tags" (
        "example_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        CONSTRAINT "PK_example_tags" PRIMARY KEY ("example_id", "tag_id"),
        CONSTRAINT "FK_example_tags_example" FOREIGN KEY ("example_id")
          REFERENCES "examples" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_example_tags_tag" FOREIGN KEY ("tag_id")
          REFERENCES "tags" ("id") ON DELETE CASCADE
      )
    `);

    // 조인 테이블의 역방향 조회(태그로 Example 찾기)를 위한 인덱스.
    // PK가 (example_id, tag_id)이므로 tag_id 단독 조회는 인덱스를 타지 못한다.
    await queryRunner.query(`
      CREATE INDEX "IDX_example_tags_tag_id" ON "example_tags" ("tag_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_example_tags_tag_id"`);
    await queryRunner.query(`DROP TABLE "example_tags"`);
    await queryRunner.query(`DROP INDEX "IDX_examples_created_at_id"`);
    await queryRunner.query(`DROP TABLE "examples"`);
    await queryRunner.query(`DROP TABLE "tags"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TYPE "example_status"`);
    // pgcrypto는 다른 마이그레이션도 쓸 수 있으므로 내리지 않는다.
  }
}
```

- [ ] **Step 5: 마이그레이션 등록 목록 작성**

`src/db/migrations/index.ts`:

```ts
import { CreateExampleSchema1787961600000 } from './20260829000000-create-example-schema.js';

/**
 * DataSource에 등록하는 마이그레이션의 유일한 목록.
 *
 * 엔티티와 같은 계약이다 — glob으로 탐색하지 않고, 이 배열에 없는 마이그레이션은
 * 실행되지 않는다. 새 마이그레이션을 만들면 파일 생성과 이 배열 추가가 한 커밋에 있어야
 * 한다. `test/db/migration-naming.spec.ts`가 디렉터리와 이 배열의 개수를 비교해 고정한다.
 *
 * 순서는 TypeORM이 클래스명 끝의 epoch millis로 정하므로 이 배열의 순서에 의존하지 않는다.
 */
export const MIGRATIONS: readonly Function[] = [CreateExampleSchema1787961600000];
```

- [ ] **Step 6: 전체 검사 후 Task 7과 함께 커밋**

```bash
pnpm typecheck
pnpm test:quick
pnpm lint
pnpm format
```

네 명령 모두 통과해야 한다. `format`이 파일을 고쳤다면 그 변경도 함께 스테이징한다.

```bash
git add package.json pnpm-lock.yaml \
        src/app/models/ src/config/database.ts src/config/data-source.ts \
        src/db/migrations/ \
        test/models/entities.spec.ts test/db/migration-naming.spec.ts
git commit -m "feat(db): 엔티티·DataSource 조립과 초기 스키마 마이그레이션 추가"
```

---
## Task 9: PostgreSQL 테스트 fixture와 마이그레이션 통합 테스트

**Files:**
- Create: `test/db/fixture.ts`
- Create: `test/integration/migrations.spec.ts`
- Modify: `jest.config.js` — `src/config/data-source.ts`를 커버리지 대상에서 제외
- Test: `test/db/fixture.spec.ts`

**Interfaces:**
- Consumes: `buildDataSourceOptions` (Task 7), `loadDatabaseSettings` (Task 6), `ENTITIES` (Task 7), `MIGRATIONS` (Task 8)
- Produces:
  - `function requireTestDatabaseUrl(env?: NodeJS.ProcessEnv): string`
  - `async function createTestDataSource(): Promise<DataSource>` — 접속 + 마이그레이션 head까지
  - `async function withRollback<T>(dataSource: DataSource, fn: (manager: EntityManager) => Promise<T>): Promise<T>`
  - `async function truncateAll(dataSource: DataSource): Promise<void>`

**설계 근거 (`_test` 접미사 강제):** 테스트는 `TRUNCATE`를 실행한다. `TEST_DATABASE_URL`을 실수로 개발 DB나 운영 DB로 두면 데이터가 사라진다. DB 이름이 `_test`로 끝나는지 검사하는 것은 그 사고를 막는 값싼 방벽이고, 스펙 15가 명시적으로 요구한다.

**설계 근거 (마이그레이션 재실행):** `createTestDataSource()`가 매번 `runMigrations()`를 호출한다. TypeORM은 `migrations` 테이블을 보고 이미 적용된 것을 건너뛰므로 두 번째 호출부터는 조회 한 번이다. Jest `globalSetup`으로 한 번만 돌리는 방법도 있지만, ESM + ts-jest 조합에서 `globalSetup`은 별도 모듈 로더를 타서 실패 모드가 늘어난다. 조회 한 번의 비용으로 그 복잡도를 사지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성 (fixture 자체)**

`test/db/fixture.spec.ts`:

```ts
import { requireTestDatabaseUrl } from './fixture.js';

describe('requireTestDatabaseUrl', () => {
  it('TEST_DATABASE_URL이 없으면 변수 이름이 담긴 오류', () => {
    expect(() => requireTestDatabaseUrl({})).toThrow('TEST_DATABASE_URL is required');
  });

  it('공백뿐이면 거부한다', () => {
    expect(() => requireTestDatabaseUrl({ TEST_DATABASE_URL: '  ' })).toThrow(
      'TEST_DATABASE_URL is required',
    );
  });

  it('_test로 끝나는 DB 이름을 받는다', () => {
    const url = 'postgres://u:p@localhost:5432/app_test';
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  it('_test로 끝나지 않으면 거부한다', () => {
    expect(() =>
      requireTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/app' }),
    ).toThrow('TEST_DATABASE_URL database name must end with "_test"');
  });

  it('운영처럼 보이는 이름도 예외 없이 거부한다', () => {
    expect(() =>
      requireTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@db.internal:5432/production' }),
    ).toThrow('must end with "_test"');
  });

  it('쿼리 문자열이 붙어도 DB 이름을 정확히 읽는다', () => {
    const url = 'postgres://u:p@localhost:5432/app_test?sslmode=disable';
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  it('URL 형식이 아니면 거부한다', () => {
    expect(() => requireTestDatabaseUrl({ TEST_DATABASE_URL: 'not-a-url' })).toThrow(
      'TEST_DATABASE_URL must be a valid connection URL',
    );
  });

  it('실제 게이트가 넘겨준 값을 받아들인다', () => {
    // check.sh는 nestjs_template_test를 만든다. 이 테스트가 그 계약을 고정한다.
    const url = 'postgres://nestjs:nestjs@127.0.0.1:55432/nestjs_template_test';
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `pnpm test:quick -- test/db/fixture.spec.ts`
기대: `Cannot find module './fixture.js'`로 FAIL.

- [ ] **Step 3: fixture 구현**

`test/db/fixture.ts`:

```ts
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { buildDataSourceOptions } from '../../src/config/database.js';

/**
 * 실제 PostgreSQL 테스트 fixture.
 *
 * 인메모리 SQLite나 모델 mock을 쓰지 않는다. 마이그레이션·관계·제약·upsert 계약은
 * 실제 엔진에서만 검증되고, 대체물로 통과시킨 테스트는 배포 시점에 무너진다.
 */

/**
 * `TEST_DATABASE_URL`을 읽고 안전 조건을 확인한다.
 *
 * DB 이름이 `_test`로 끝나야 한다. 이 fixture는 `TRUNCATE`를 실행하므로, 변수를
 * 실수로 개발 DB나 운영 DB로 두면 데이터가 사라진다. 접미사 검사는 그 사고를 막는
 * 값싼 방벽이다 — 편의를 위해 우회로를 만들지 않는다.
 */
export function requireTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TEST_DATABASE_URL;
  if (raw === undefined || raw.trim() === '') {
    throw new Error('TEST_DATABASE_URL is required');
  }

  const url = raw.trim();
  let databaseName: string;
  try {
    // 끝 슬래시를 먼저 떼어낸다. `.../app_test/`가 `app_test/`로 읽혀 정당한 URL이
    // 거부되는 것을 막는다.
    databaseName = new URL(url).pathname.replace(/^\//, '').replace(/\/$/, '');
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid connection URL');
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL database name must end with "_test" (received "${databaseName}")`,
    );
  }

  return url;
}

/**
 * 마이그레이션을 head까지 적용한 `DataSource`를 만든다.
 *
 * `runMigrations()`를 매번 호출한다. TypeORM이 `migrations` 테이블을 보고 이미
 * 적용된 것을 건너뛰므로 두 번째부터는 조회 한 번이다. Jest `globalSetup`으로 한 번만
 * 돌리는 방법도 있으나, ESM + ts-jest에서 `globalSetup`은 별도 모듈 로더를 타서
 * 실패 모드가 늘어난다. 조회 한 번의 비용으로 그 복잡도를 사지 않는다.
 */
export async function createTestDataSource(): Promise<DataSource> {
  const url = requireTestDatabaseUrl();
  const dataSource = new DataSource(
    buildDataSourceOptions({
      url,
      poolMax: 5,
      idleTimeoutMs: 10000,
      connectionTimeoutMs: 10000,
    }),
  );
  await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource;
}

/**
 * 콜백을 트랜잭션 안에서 실행하고 **항상** 롤백한다.
 *
 * 테스트끼리 상태를 남기지 않는 기본 격리 수단이다. 콜백이 성공해도 커밋하지 않으므로,
 * commit 이후를 관찰해야 하는 테스트(동시성, `ON CONFLICT` 경합)는 이 함수를 쓰지 않고
 * `truncateAll`로 정리한다.
 */
export async function withRollback<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    return await fn(queryRunner.manager);
  } finally {
    try {
      await queryRunner.rollbackTransaction();
    } catch {
      // 롤백 실패를 삼킨다. `fn`이 던진 오류가 진단의 근거인데, `finally`에서 새 오류가
      // 나가면 JS 의미상 그 원래 오류를 덮어버린다. 롤백 실패는 대개 원래 실패의 결과다.
    } finally {
      // 롤백이 어떻게 되든 커넥션은 반드시 돌려준다. 여기서 새면 풀이 마른다.
      await queryRunner.release();
    }
  }
}

/**
 * 모든 테이블을 비운다.
 *
 * commit을 관찰하는 테스트의 정리 수단이다. `migrations` 테이블은 남긴다 — 지우면
 * 다음 `createTestDataSource()`가 마이그레이션을 처음부터 다시 돌린다.
 */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas.map((metadata) => `"${metadata.tableName}"`);
  if (tables.length === 0) {
    return;
  }
  await dataSource.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 4: 마이그레이션 통합 테스트 작성**

`test/integration/migrations.spec.ts`:

```ts
import type { DataSource } from 'typeorm';
import { createTestDataSource, truncateAll, withRollback } from '../db/fixture.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';

describe('마이그레이션 적용', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('스펙이 정한 테이블을 모두 만든다', async () => {
    const rows = (await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )) as { table_name: string }[];
    const names = rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining(['examples', 'categories', 'tags', 'example_tags']));
  });

  it('example_status enum을 만든다', async () => {
    const rows = (await dataSource.query(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'example_status'
       ORDER BY enumlabel`,
    )) as { enumlabel: string }[];
    expect(rows.map((row) => row.enumlabel)).toEqual(['archived', 'draft', 'published']);
  });

  it('(created_at, id) 인덱스를 만든다', async () => {
    const rows = (await dataSource.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'examples'`,
    )) as { indexname: string }[];
    expect(rows.map((row) => row.indexname)).toContain('IDX_examples_created_at_id');
  });

  it('적용 대기 중인 마이그레이션이 없다', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
  });

  it('엔티티 메타데이터가 실제 스키마와 어긋나지 않는다', async () => {
    // synchronize가 만들려는 SQL이 비어 있어야 엔티티와 마이그레이션이 일치한다.
    const sqlInMemory = await dataSource.driver.createSchemaBuilder().log();
    expect(sqlInMemory.upQueries).toHaveLength(0);
  });
});

describe('스키마 제약', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await truncateAll(dataSource);
    await dataSource.destroy();
  });

  it('Example을 저장하고 기본값을 적용한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const saved = await manager.save(manager.create(Example, { title: '제목' }));
      expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(saved.status).toBe('draft');
      expect(saved.body).toBeNull();
      expect(saved.categoryId).toBeNull();
      expect(saved.createdAt).toBeInstanceOf(Date);
    });
  });

  it('category 이름은 유일하다', async () => {
    await expect(
      withRollback(dataSource, async (manager) => {
        await manager.save(manager.create(Category, { name: '중복' }));
        await manager.save(manager.create(Category, { name: '중복' }));
      }),
      // 인자 없는 toThrow()는 SQL 오타나 커넥션 끊김으로 실패해도 통과한다.
      // 어떤 제약이 걸렸는지까지 고정한다.
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('tag 이름은 유일하다', async () => {
    await expect(
      withRollback(dataSource, async (manager) => {
        await manager.save(manager.create(Tag, { name: '중복' }));
        await manager.save(manager.create(Tag, { name: '중복' }));
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('category 삭제가 Example을 지우지 않고 FK만 푼다', async () => {
    await withRollback(dataSource, async (manager) => {
      const category = await manager.save(manager.create(Category, { name: '분류' }));
      const example = await manager.save(
        manager.create(Example, { title: '제목', categoryId: category.id }),
      );
      await manager.delete(Category, { id: category.id });
      const reloaded = await manager.findOneByOrFail(Example, { id: example.id });
      expect(reloaded.categoryId).toBeNull();
    });
  });

  it('Example 삭제가 조인 행을 함께 지운다', async () => {
    await withRollback(dataSource, async (manager) => {
      const tag = await manager.save(manager.create(Tag, { name: '라벨' }));
      const example = await manager.save(
        manager.create(Example, { title: '제목', tags: [tag] }),
      );
      await manager.delete(Example, { id: example.id });
      const rows = (await manager.query(
        `SELECT COUNT(*)::int AS count FROM example_tags WHERE example_id = $1`,
        [example.id],
      )) as { count: number }[];
      // 인덱싱을 피한다 — 배열 전체를 비교하면 `noUncheckedIndexedAccess`에 걸리지 않고
      // "행이 정확히 하나"라는 것까지 함께 단언하게 된다.
      expect(rows).toEqual([{ count: 0 }]);
    });
  });

  it('to-many 관계를 저장하고 되읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const tags = await manager.save([
        manager.create(Tag, { name: 'a' }),
        manager.create(Tag, { name: 'b' }),
      ]);
      const example = await manager.save(manager.create(Example, { title: '제목', tags }));
      const reloaded = await manager.findOneOrFail(Example, {
        where: { id: example.id },
        relations: { tags: true },
      });
      expect(reloaded.tags?.map((tag) => tag.name).sort()).toEqual(['a', 'b']);
    });
  });

  it('허용되지 않은 status를 거부한다', async () => {
    await expect(
      withRollback(dataSource, async (manager) => {
        await manager.query(
          `INSERT INTO examples (title, status) VALUES ('제목', 'unknown')`,
        );
      }),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it('withRollback이 실제로 롤백한다', async () => {
    let createdId = '';
    await withRollback(dataSource, async (manager) => {
      const saved = await manager.save(manager.create(Example, { title: '사라질 것' }));
      createdId = saved.id;
    });
    const found = await dataSource.getRepository(Example).findOneBy({ id: createdId });
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 5: 커버리지 대상에서 CLI 전용 파일 제외**

`jest.config.js`의 `collectCoverageFrom`을 아래로 바꾼다:

```js
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/config/main.ts',
    // TypeORM CLI 전용. import 시점에 loadDatabaseSettings()를 실행하므로 단위 테스트에서
    // 불러올 수 없고, 실제 계약(buildDataSourceOptions)은 database.ts 쪽에서 검증된다.
    '!src/config/data-source.ts',
    // 등록 배열만 담은 파일. 내용은 entities.spec.ts / migration-naming.spec.ts가 고정한다.
    '!src/app/models/index.ts',
    '!src/db/migrations/index.ts',
  ],
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인**

이 태스크의 테스트는 실제 PostgreSQL을 요구한다. 게이트 전체로 돌린다:

```bash
./scripts/check.sh
```

기대: exit 0. 커버리지 80% 게이트도 통과해야 한다.

`TEST_DATABASE_URL` 없이 `pnpm test:quick`만 돌리면 DB 테스트가 실패하는 것이 **정상**이다. 이 사실을 리포트에 적는다 — 이후 태스크의 구현자가 같은 실패를 버그로 오인하지 않도록.

- [ ] **Step 7: 커밋**

```bash
git add test/db/fixture.ts test/db/fixture.spec.ts test/integration/migrations.spec.ts jest.config.js
git commit -m "test(db): 실제 PostgreSQL fixture와 마이그레이션 통합 테스트 추가"
```

---

## Task 10: 결정적 시드

**Files:**
- Create: `src/db/seeds.ts`
- Test: `test/integration/seeds.spec.ts`

**Interfaces:**
- Consumes: `Example`, `Category`, `Tag` (Task 7), `withRollback`, `createTestDataSource` (Task 9)
- Produces:
  - `const SEED_CATEGORY_IDS: Readonly<Record<string, string>>`
  - `const SEED_TAG_IDS: Readonly<Record<string, string>>`
  - `const SEED_EXAMPLE_IDS: Readonly<Record<string, string>>`
  - `async function seed(manager: EntityManager): Promise<void>`
  - `async function main(): Promise<void>` — `node dist/db/seeds.js` 진입점

**설계 근거 (호출자 소유 트랜잭션):** `seed(manager)`가 `EntityManager`를 인자로 받고 스스로 트랜잭션을 열지 않는다. 테스트는 `withRollback`이 만든 트랜잭션 안에서 부르고, CLI는 자기 트랜잭션을 연다. 시드가 트랜잭션을 소유하면 테스트가 시드 결과를 롤백할 수 없다.

**설계 근거 (고정 UUID + upsert):** 스펙 11이 "고정 식별자와 PostgreSQL upsert"를 요구한다. 시드를 두 번 돌려도 결과가 같아야 배포 절차에서 안전하게 재실행할 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/integration/seeds.spec.ts`:

```ts
import type { DataSource } from 'typeorm';
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import {
  SEED_CATEGORY_IDS,
  SEED_EXAMPLE_IDS,
  SEED_TAG_IDS,
  seed,
} from '../../src/db/seeds.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

describe('결정적 시드', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('고정 식별자를 선언한다', () => {
    const ids = [
      ...Object.values(SEED_CATEGORY_IDS),
      ...Object.values(SEED_TAG_IDS),
      ...Object.values(SEED_EXAMPLE_IDS),
    ];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('선언한 모든 행을 만든다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      expect(await manager.count(Category)).toBe(Object.keys(SEED_CATEGORY_IDS).length);
      expect(await manager.count(Tag)).toBe(Object.keys(SEED_TAG_IDS).length);
      expect(await manager.count(Example)).toBe(Object.keys(SEED_EXAMPLE_IDS).length);
    });
  });

  it('선언한 식별자를 그대로 쓴다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      for (const id of Object.values(SEED_CATEGORY_IDS)) {
        expect(await manager.findOneBy(Category, { id })).not.toBeNull();
      }
      for (const id of Object.values(SEED_EXAMPLE_IDS)) {
        expect(await manager.findOneBy(Example, { id })).not.toBeNull();
      }
    });
  });

  it('두 번 돌려도 행이 늘지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      const first = await manager.count(Example);
      await seed(manager);
      expect(await manager.count(Example)).toBe(first);
    });
  });

  it('두 번 돌려도 관계가 중복되지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      await seed(manager);
      const rows = (await manager.query(
        `SELECT example_id, tag_id, COUNT(*)::int AS count
         FROM example_tags GROUP BY example_id, tag_id HAVING COUNT(*) > 1`,
      )) as unknown[];
      expect(rows).toHaveLength(0);
    });
  });

  it('수정된 행을 선언 값으로 되돌린다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      const [id] = Object.values(SEED_EXAMPLE_IDS);
      if (id === undefined) {
        throw new Error('SEED_EXAMPLE_IDS는 비어 있을 수 없다');
      }
      const before = await manager.findOneByOrFail(Example, { id });
      await manager.update(Example, { id }, { title: '손으로 바꾼 제목' });
      await seed(manager);
      const after = await manager.findOneByOrFail(Example, { id });
      expect(after.title).toBe(before.title);
    });
  });

  it('Example에 관계를 연결한다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      const examples = await manager.find(Example, {
        relations: { tags: true, category: true },
      });
      expect(examples.some((example) => example.categoryId !== null)).toBe(true);
      expect(examples.some((example) => (example.tags?.length ?? 0) > 0)).toBe(true);
    });
  });

  it('트랜잭션을 스스로 열지 않는다 (호출자가 롤백할 수 있다)', async () => {
    await withRollback(dataSource, async (manager) => {
      await seed(manager);
      expect(await manager.count(Example)).toBeGreaterThan(0);
    });
    // 롤백 뒤에는 아무것도 남지 않아야 한다.
    expect(await dataSource.getRepository(Example).count()).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `./scripts/check.sh` (또는 `TEST_DATABASE_URL`을 직접 주고 `pnpm test:quick -- test/integration/seeds.spec.ts`)
기대: `Cannot find module '../../src/db/seeds.js'`로 FAIL.

- [ ] **Step 3: 구현 작성**

`src/db/seeds.ts`:

```ts
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Category } from '../app/models/category.entity.js';
import { Example } from '../app/models/example.entity.js';
import { Tag } from '../app/models/tag.entity.js';
import { buildDataSourceOptions } from '../config/database.js';
import { loadDatabaseSettings } from '../config/settings.js';

/**
 * 결정적 시드.
 *
 * 고정 UUID와 PostgreSQL upsert를 쓴다. 몇 번을 돌려도 같은 결과가 나와야 배포 절차에서
 * 안전하게 재실행할 수 있다. 손으로 바꾼 행도 선언 값으로 되돌린다 — 시드는 "이 상태여야
 * 한다"는 선언이지 "없으면 만든다"는 보정이 아니다.
 *
 * `seed()`는 트랜잭션을 스스로 열지 않고 `EntityManager`를 받는다. 테스트는 롤백되는
 * 트랜잭션 안에서 부르고 CLI는 자기 트랜잭션을 연다. 시드가 트랜잭션을 소유하면 테스트가
 * 결과를 롤백할 수 없다.
 */

/** 시드 분류의 고정 식별자. */
export const SEED_CATEGORY_IDS: Readonly<Record<string, string>> = {
  guides: '0195c1a0-0000-7000-8000-000000000001',
  references: '0195c1a0-0000-7000-8000-000000000002',
};

/** 시드 라벨의 고정 식별자. */
export const SEED_TAG_IDS: Readonly<Record<string, string>> = {
  jsonapi: '0195c1a0-0000-7000-8000-000000000011',
  nestjs: '0195c1a0-0000-7000-8000-000000000012',
  postgres: '0195c1a0-0000-7000-8000-000000000013',
};

/** 시드 Example의 고정 식별자. */
export const SEED_EXAMPLE_IDS: Readonly<Record<string, string>> = {
  gettingStarted: '0195c1a0-0000-7000-8000-000000000021',
  queryPolicy: '0195c1a0-0000-7000-8000-000000000022',
};

interface CategorySeed {
  readonly id: string;
  readonly name: string;
}

interface TagSeed {
  readonly id: string;
  readonly name: string;
}

interface ExampleSeed {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: 'draft' | 'published' | 'archived';
  readonly categoryId: string;
  readonly tagIds: readonly string[];
}

const CATEGORIES: readonly CategorySeed[] = [
  { id: SEED_CATEGORY_IDS.guides, name: '안내서' },
  { id: SEED_CATEGORY_IDS.references, name: '참고 자료' },
];

const TAGS: readonly TagSeed[] = [
  { id: SEED_TAG_IDS.jsonapi, name: 'json-api' },
  { id: SEED_TAG_IDS.nestjs, name: 'nestjs' },
  { id: SEED_TAG_IDS.postgres, name: 'postgres' },
];

const EXAMPLES: readonly ExampleSeed[] = [
  {
    id: SEED_EXAMPLE_IDS.gettingStarted,
    title: '시작하기',
    body: '이 템플릿으로 JSON:API 자원을 추가하는 방법을 설명한다.',
    status: 'published',
    categoryId: SEED_CATEGORY_IDS.guides,
    tagIds: [SEED_TAG_IDS.jsonapi, SEED_TAG_IDS.nestjs],
  },
  {
    id: SEED_EXAMPLE_IDS.queryPolicy,
    title: '조회 정책',
    body: 'filter·sort·include 허용 목록을 선언하는 방법을 설명한다.',
    status: 'draft',
    categoryId: SEED_CATEGORY_IDS.references,
    tagIds: [SEED_TAG_IDS.postgres],
  },
];

/**
 * 시드를 적용한다.
 *
 * 호출자가 트랜잭션을 소유한다. 이 함수는 commit도 rollback도 하지 않는다.
 */
export async function seed(manager: EntityManager): Promise<void> {
  await manager
    .createQueryBuilder()
    .insert()
    .into(Category)
    .values([...CATEGORIES])
    .orUpdate(['name'], ['id'])
    .execute();

  await manager
    .createQueryBuilder()
    .insert()
    .into(Tag)
    .values([...TAGS])
    .orUpdate(['name'], ['id'])
    .execute();

  await manager
    .createQueryBuilder()
    .insert()
    .into(Example)
    .values(
      EXAMPLES.map((example) => ({
        id: example.id,
        title: example.title,
        body: example.body,
        status: example.status,
        categoryId: example.categoryId,
      })),
    )
    .orUpdate(['title', 'body', 'status', 'category_id'], ['id'])
    .execute();

  // 조인 행은 선언 상태로 맞춘다. 먼저 지우고 다시 넣어야 시드에서 뺀 관계도 사라진다.
  for (const example of EXAMPLES) {
    await manager.query(`DELETE FROM example_tags WHERE example_id = $1`, [example.id]);
    for (const tagId of example.tagIds) {
      await manager.query(
        `INSERT INTO example_tags (example_id, tag_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [example.id, tagId],
      );
    }
  }
}

/**
 * `node dist/db/seeds.js` 진입점.
 *
 * 여기서 트랜잭션을 연다. 시드 전체가 한 트랜잭션이므로 도중에 실패하면 아무것도 남지 않는다.
 */
export async function main(): Promise<void> {
  const dataSource = new DataSource(buildDataSourceOptions(loadDatabaseSettings()));
  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      await seed(manager);
    });
  } finally {
    await dataSource.destroy();
  }
}
```

`src/db/seeds.ts` 파일 맨 끝에 CLI 진입 분기를 추가한다:

```ts
// `node dist/db/seeds.js`로 직접 실행할 때만 동작한다. import될 때는 아무 일도 하지 않는다.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인**

실행: `./scripts/check.sh`
기대: exit 0.

`main()`과 CLI 진입 분기는 단위 테스트가 덮지 않는다. 커버리지 80% 게이트를 넘지 못하면 `jest.config.js`의 `collectCoverageFrom`에서 제외하지 **말고**, 리포트에 현재 커버리지 수치를 적어 보고한다. 제외 여부는 컨트롤러가 판단한다.

- [ ] **Step 5: 커밋**

```bash
git add src/db/seeds.ts test/integration/seeds.spec.ts
git commit -m "feat(db): 고정 식별자와 upsert 기반 결정적 시드 추가"
```

---

## Task 11: Nest DB 연결, readiness 확인, 스크립트와 문서

**Files:**
- Modify: `src/config/app.module.ts` — `TypeOrmModule` 연결
- Modify: `src/app/controllers/health.controller.ts` — readiness가 DB를 확인
- Modify: `package.json` — `test:jsonapi`, `test:controllers`, `test:db`, `migrate`, `seed`, `db:up` 추가
- Modify: `README.md` — 환경 변수·마이그레이션·시드 절 추가
- Modify: `test/app-factory.ts` — DB 연결이 필요한 앱 조립
- Modify: `test/health.controller.spec.ts` — readiness 회귀
- Modify: `test/docs/readme.spec.ts` — 새 명령 문자열 동기화

**Interfaces:**
- Consumes: 앞선 모든 태스크
- Produces: 없음 (마감 태스크)

**주의 (조립 지점 하나):** `test/app-factory.ts`가 애플리케이션 테스트의 유일한 조립 지점이라는 Phase 0의 계약을 유지한다. DB 연결이 생겨도 각 spec이 `Test.createTestingModule`을 직접 부르지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/health.controller.spec.ts`에 아래를 추가한다:

```ts
  it('readiness가 데이터베이스를 확인한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('liveness는 데이터베이스를 확인하지 않는다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
```

`test/docs/readme.spec.ts`의 `## 검증` 절 단언은 그대로 두고, 아래 `describe`를 파일 끝에 추가한다:

```ts
describe('README 환경 변수 문서', () => {
  it('필수 환경 변수를 모두 문서화한다', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    for (const name of ['DATABASE_URL', 'DB_POOL_MAX', 'PORT', 'TEST_DATABASE_URL']) {
      expect(readme).toContain(name);
    }
  });

  it('마이그레이션과 시드 명령을 문서화한다', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('pnpm migrate');
    expect(readme).toContain('pnpm seed');
  });
});
```

(`readFileSync`와 `join`이 이미 import되어 있는지 확인하고, 없으면 파일 상단에 추가한다.)

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

실행: `./scripts/check.sh`
기대: readiness 테스트가 `{ status: 'ok' }`만 받아 FAIL, README 테스트가 문자열 없음으로 FAIL.

- [ ] **Step 3: `AppModule`에 DB 연결**

`src/config/app.module.ts`를 아래로 바꾼다:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JsonApiExceptionFilter } from '../app/jsonapi/exception-filter.js';
import { JsonApiResponseInterceptor } from '../app/jsonapi/response.js';
import { buildDataSourceOptions } from './database.js';
import { RoutesModule } from './routes.module.js';
import { loadDatabaseSettings } from './settings.js';

/**
 * 애플리케이션 루트 모듈. 전역 미들웨어와 필터는 여기에서 등록 순서까지 검토한다.
 *
 * 예외 필터는 전역이고 응답 인터셉터는 라우트별로 꺼진다. 근거는 두 파일의 주석에 있다.
 *
 * `DATABASE_URL`은 모듈 조립 시점에 읽는다. 없으면 프로세스가 시작되지 않는다 —
 * 첫 요청에서야 드러나는 설정 오류보다 시작 실패가 낫다.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDataSourceOptions(loadDatabaseSettings()),
    }),
    RoutesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: JsonApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: JsonApiResponseInterceptor },
  ],
})
export class AppModule {}
```

- [ ] **Step 4: readiness가 DB를 확인하게 고침**

`src/app/controllers/health.controller.ts`를 아래로 바꾼다:

```ts
import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JsonApiError } from '../jsonapi/errors.js';
import { SkipJsonApiNegotiation } from '../jsonapi/negotiation.js';

/** liveness 응답. */
export interface LiveStatus {
  readonly status: string;
}

/** readiness 응답. */
export interface ReadyStatus {
  readonly status: string;
  readonly database: string;
}

/**
 * 상태 확인 컨트롤러.
 *
 * JSON:API 협상 대상이 아니다. vendor 미디어 타입 없이 평문 JSON을 반환한다.
 * 이 의도를 `@SkipJsonApiNegotiation()`으로 코드에 남긴다.
 *
 * liveness는 어떤 외부 자원도 해석하지 않는다 — 프로세스가 살아 있는지만 답한다.
 * DB가 죽었을 때 liveness가 실패하면 오케스트레이터가 멀쩡한 프로세스를 재시작하는데,
 * 재시작은 DB를 되살리지 못하므로 무한 재시작 루프가 된다.
 *
 * readiness는 DB를 확인한다. 트래픽을 받을 준비가 됐는지가 곧 DB에 닿는지이기 때문이다.
 */
@SkipJsonApiNegotiation()
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('live')
  live(): LiveStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<ReadyStatus> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new JsonApiError('INTERNAL_SERVER_ERROR', {
        detail: 'the database is not reachable',
      });
    }
    return { status: 'ok', database: 'ok' };
  }
}
```

- [ ] **Step 5: npm scripts 추가**

`package.json`의 `scripts`에 아래를 추가한다 (기존 항목은 건드리지 않는다):

```json
    "test:jsonapi": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi",
    "test:controllers": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers",
    "test:db": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/integration test/db test/models",
    "migrate": "typeorm migration:run -d dist/config/data-source.js",
    "seed": "node dist/db/seeds.js",
    "db:up": "docker compose up -d --wait db"
```

`test:controllers`가 가리키는 `test/controllers/`는 Phase 4에서 생긴다. 지금은 빈 경로이므로 Jest가 "no tests found"로 종료 코드 1을 낸다 — 이는 정상이고, 이 스크립트를 지금 게이트에 넣지 않는다.

- [ ] **Step 6: README 갱신**

`README.md`의 `## 요구 사항` 절 다음에 아래 두 절을 삽입한다. `## 검증` 절의 명령 문자열은 **한 글자도 바꾸지 않는다** — `test/docs/readme.spec.ts`가 고정하고 있다.

````markdown
## 환경 변수

애플리케이션 코드에 암묵적 기본값을 두지 않는다. 필수 값이 없으면 변수 이름이 담긴 오류로 프로세스가 시작되지 않는다.

| 변수 | 필요한 프로세스 | 기본값 | 비고 |
| --- | --- | --- | --- |
| `DATABASE_URL` | API, 마이그레이션, 시드 | 없음(필수) | `postgres://user:pass@host:5432/db` |
| `PORT` | API | `4000` | |
| `DB_POOL_MAX` | DB 접속 프로세스 | `10` | 1 이상 |
| `DB_POOL_IDLE_TIMEOUT_MS` | DB 접속 프로세스 | `30000` | |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | DB 접속 프로세스 | `30000` | |
| `TEST_DATABASE_URL` | 테스트 | 없음(`check.sh`가 만든다) | DB 이름이 `_test`로 끝나야 한다 |

`TEST_DATABASE_URL`의 `_test` 접미사 검사는 사고 방지 장치다. 테스트는 `TRUNCATE`를 실행하므로 이 변수를 개발 DB로 두면 데이터가 사라진다.

## 데이터베이스

스키마 변경은 마이그레이션으로만 전달한다. `synchronize`는 모든 환경에서 `false`다.

```bash
pnpm db:up          # 로컬 PostgreSQL 기동
pnpm build          # 마이그레이션과 시드는 dist/ 를 실행한다
pnpm migrate        # 마이그레이션을 head까지 적용
pnpm seed           # 결정적 시드 적용 (몇 번을 돌려도 결과가 같다)
```

새 마이그레이션의 파일명은 `<UTC yyyyMMddHHmmss>-<kebab-name>.ts`, 클래스명은 `<PascalName><epochMillis>`이며 두 타임스탬프가 같은 시각을 가리켜야 한다. 만든 뒤 `src/db/migrations/index.ts`의 `MIGRATIONS` 배열에 추가한다 — 배열에 없는 마이그레이션은 실행되지 않는다. `test/db/migration-naming.spec.ts`가 이 두 규칙을 고정한다.
````

`## 구조` 절의 디렉터리 목록에 이번에 생긴 경로를 추가한다:

```text
src/app/jsonapi/       # JSON:API 프로토콜 — 오류·언어·문서·협상·필터·응답
src/app/models/        # TypeORM 엔티티
src/config/database.ts # DataSource 조립
src/db/migrations/     # 마이그레이션 (명시 등록)
src/db/seeds.ts        # 결정적 시드
```

그리고 "아직 구현되지 않은 것"을 설명하는 문단이 있다면 Phase 1-2가 끝났음을 반영해 갱신한다. 남은 것은 선언형 CRUD(`CrudActions`), 시리얼라이저와 조회 정책, 인증, 비동기 작업이다.

- [ ] **Step 7: `test/app-factory.ts` 확인**

`createTestApp()`이 `AppModule`을 조립하므로 이제 `DATABASE_URL`이 필요하다. `test/app-factory.ts` 상단에 아래 주석과 코드를 추가한다:

```ts
/**
 * 테스트 앱은 `TEST_DATABASE_URL`이 가리키는 DB에 붙는다.
 *
 * `AppModule`이 `DATABASE_URL`을 읽으므로 조립 전에 옮겨 담는다. 테스트가 운영 변수
 * 이름을 직접 세팅하면 실수로 개발 DB에 붙을 수 있으므로, 여기 한 곳에서만 변환한다.
 */
function useTestDatabase(): void {
  process.env.DATABASE_URL = requireTestDatabaseUrl();
}
```

그리고 `createTestApp()`의 첫 줄에서 `useTestDatabase()`를 호출한다. `requireTestDatabaseUrl`은 `./db/fixture.js`에서 import한다.

- [ ] **Step 8: 전체 게이트 통과 확인**

```bash
./scripts/check.sh
```

기대: exit 0, 커버리지 80% 이상.

이어서 컨테이너 경로도 확인한다:

```bash
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
```

기대: 두 명령 모두 exit 0.

- [ ] **Step 9: 커밋**

```bash
git add src/config/app.module.ts src/app/controllers/health.controller.ts \
        package.json README.md test/app-factory.ts \
        test/health.controller.spec.ts test/docs/readme.spec.ts
git commit -m "feat: Nest DB 연결과 readiness 확인, 마이그레이션·시드 스크립트 추가"
```

---

## Self-Review 결과

계획을 다 쓴 뒤 스펙과 대조한 결과다.

**1. 스펙 커버리지 (Phase 1-2 범위)**

| 스펙 요구 | 태스크 |
| --- | --- |
| 5.2 24개 오류 코드, `ERROR_CATALOG` | Task 1 |
| 5.2 `Accept-Language` 해석, 기본 `ko` | Task 2 |
| 5.1 문서 모델 | Task 3 |
| 5.1 `Accept` 406 / `Content-Type` 415 | Task 4 |
| 5.2 전역 예외 필터 | Task 5 |
| 5.3 vendor `Content-Type` 응답 | Task 5 |
| 7.1 `presentKeys` 캡처 | Task 3 |
| 12 환경 변수와 오류 문구 | Task 6 |
| 11 PostgreSQL 전용, `synchronize: false` | Task 7 |
| 11.1 마이그레이션 명명 규약과 검사 | Task 8 |
| 11 결정적 시드, 고정 식별자, upsert | Task 10 |
| 15 실제 PostgreSQL, `_test` 접미사, 트랜잭션 롤백 | Task 9 |
| 13.1 `migrate`/`seed`/`test:*` 스크립트 | Task 11 |
| 14 README 문서 갱신 | Task 11 |

**범위에서 의도적으로 뺀 것** (Phase 3 이후):
- `QueryPolicy`와 조회 컴파일 (스펙 8) — Phase 3
- 시리얼라이저 (스펙 6) — Phase 3
- `CrudActions`와 관계 라우트 (스펙 6, 7.2, 7.3) — Phase 4
- `AGENTS.md` 문서군 (스펙 14) — Phase 8. 지금 쓰면 Phase 3-7에서 매번 고쳐야 한다.
- Express body parser의 `type: 'application/vnd.api+json'` 등록 (스펙 5.1) — 본문을 받는 리소스 라우트가 Phase 4에 생기므로 그때 함께 넣는다. Phase 1-2에는 JSON:API 본문을 받는 라우트가 없다.

**2. 플레이스홀더 점검**

"TBD", "적절한 오류 처리 추가", "위 내용의 테스트 작성" 같은 표현 없음. 모든 코드 스텝에 실제 코드가 들어 있음.

**3. 타입 일관성**

- `JsonApiError`의 생성자 시그니처가 Task 1 정의와 Task 3·4·5·11의 호출부에서 일치한다.
- `JsonApiErrorSource`를 Task 1이 정의하고 Task 5가 `import type`으로 재사용한다 — 두 번 정의하지 않는다.
- `NEGOTIATE_ACCEPT_KEY`를 Task 4가 정의하고 Task 5의 인터셉터가 읽는다. 키를 나누지 않는 이유를 두 파일 주석에 남겼다.
- `DatabaseSettings`를 Task 6이 정의하고 Task 7의 `buildDataSourceOptions`, Task 9의 fixture가 같은 모양으로 쓴다.
- `ENTITIES`/`MIGRATIONS`가 모두 `readonly Function[]`이고 `buildDataSourceOptions`에서 `[...ENTITIES]`로 펼친다 — TypeORM 옵션이 가변 배열을 요구하기 때문이다.
- `HealthStatus`가 Task 11에서 `LiveStatus`/`ReadyStatus`로 갈라진다. Phase 0의 `HealthStatus`를 import하는 곳이 `health.controller.ts` 자신뿐이므로 외부 파급이 없다.

**4. 발견해서 고친 것**

- Task 7이 `src/db/migrations/index.ts`를 import하는데 그 파일은 Task 8에서 생긴다. 두 태스크 사이에 `typecheck`가 깨지는 구간이 생기므로, Task 7 Step 11을 "커밋 보류"로 바꾸고 Task 8 Step 6에서 함께 커밋하도록 고쳤다.
- Task 9의 fixture가 `buildDataSourceOptions`에 `DatabaseSettings` 전체를 넘겨야 하는데 처음에는 URL만 넘기게 썼다. 풀 설정까지 담은 객체 리터럴로 고쳤다.
- `src/config/data-source.ts`는 import 시점에 `loadDatabaseSettings()`를 실행하므로 단위 테스트가 불러올 수 없다. Task 9 Step 5에서 커버리지 대상에서 제외하도록 추가했다.
