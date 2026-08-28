# NestJS JSON:API 템플릿 설계

- 작성일: 2026-08-28
- 대상 저장소: `builder-shin/template-typescript-nestjs`
- 참조 구현: `builder-shin/template-python-fastapi`

## 1. 목표

참조 템플릿과 **동일한 설계 철학·공개 계약·문서 구조**를 TypeScript/NestJS로 옮긴다. 포팅 대상은 코드가 아니라 계약이다.

가져오는 계약:

- JSON:API 1.1 전용 프로토콜 (`application/vnd.api+json` 협상, 오류 문서, `Accept-Language` ko/en)
- 선언형 CRUD 컨트롤러 — 컨트롤러에는 모델·시리얼라이저·쓰기 스키마·조회 정책의 **선언만** 둔다
- 계층 소유권 분리 (models / schemas / serializers / controllers)
- 명시적 라우트 등록 — 자동 탐색 없음
- 실제 PostgreSQL로 검증하는 단일 게이트 스크립트
- 루트 + 계층별 `AGENTS.md` 문서군

### 1.1 비목표 (YAGNI)

- 리소스별 repository 또는 service 계층
- `fields[...]` 희소 필드셋
- SQLite 호환 경로 및 인메모리 DB 테스트
- 라우트 자동 탐색, 숨은 import 등록
- GraphQL, WebSocket, 멀티테넌시, 소셜 로그인/OAuth 제공자
- 스케줄러 의존성 (외부 cron이 enqueue만 담당)

## 2. 확정 스택

버전은 2026-08-28 기준 npm 레지스트리 실측값이다. 세 항목은 조사 과정에서 통념이 뒤집힌 것으로, 근거를 함께 남긴다.

| 항목 | 선택 | 근거 |
| --- | --- | --- |
| Node | 24 LTS, `engines: >=24.11.0` | `typeorm@1.1.0`의 engines가 `^20.19.0 \|\| ^22.13.0 \|\| >=24.11.0` |
| TypeScript | **6.0.3** | 최신은 7.0.2이나 TS 7은 네이티브(Go) 컴파일러라 JS 컴파일러 API를 노출하지 않는다. 실행 결과: `The TypeScript compiler "typescript" (version 7.0.2) does not expose the JavaScript compiler API required by ts-jest`. `ts-jest@29` peer는 `>=4.3 <7`, `typescript-eslint@8.68` peer는 `>=4.8.4 <6.1.0` |
| 모듈 형식 | **ESM** (`"type": "module"`) | `@nestjs/common@12`·`@nestjs/core@12`의 package.json이 `"type": "module"`이며 CJS 빌드가 없다 |
| 프레임워크 | NestJS 12.0.1 + `@nestjs/platform-express` | |
| ORM | TypeORM **1.1.0** | `0.3.31`은 `legacy` dist-tag. `@nestjs/typeorm@12.0.1` peer가 `^0.3.0 \|\| ^1.0.0-dev` |
| DB 드라이버 | `pg` 8 | |
| 검증 | class-validator 0.15 + class-transformer 0.5 | |
| OpenAPI | `@nestjs/swagger` 12 | |
| 큐 | BullMQ 6 + `@nestjs/bullmq` 12 | |
| 인증 | `@nestjs/jwt` 12 + `argon2` 0.45 | |
| 테스트 | Jest 30.5 + ts-jest 29 + supertest 7 | ESM에서 `node --experimental-vm-modules`로 구동 |
| 린트/포맷 | ESLint 10.9 + typescript-eslint 8.68 + Prettier 3.9 | |
| 비밀 탐지 | **secretlint** | 참조는 Python `pre-commit` + `detect-secrets`. TS 저장소에 Python 런타임을 요구하지 않기 위한 npm 네이티브 대체 |
| 훅 | husky + lint-staged | `pre-commit` 프레임워크의 npm 대응 |
| 패키지 매니저 | pnpm 11 (`--frozen-lockfile`) | `uv sync --frozen` 대응 |

### 2.1 사전 검증 결과

설계의 핵심 가정을 폐기용 프로브로 실측했다. 세 항목 모두 통과했다.

1. mixin 팩토리가 반환한 베이스 클래스의 라우트가 서브클래스에서 등록된다.
2. 베이스 클래스에 선언한 `@Param`/`@Body`/`@Query` 파라미터 바인딩이 서브클래스 인스턴스에서 동작한다.
3. 프로토타입에 동적 정의한 메서드에 `Get(path)(proto, name, descriptor)`로 데코레이터를 프로그래매틱 적용하면 관계별 개별 경로로 등록된다.

컨트롤러 2개(`examples`: category/tags, `articles`: author)로 총 14개 라우트가 충돌 없이 등록되었고, Jest ESM 환경에서 3개 테스트가 모두 통과했다.

### 2.2 tsconfig 제약

```jsonc
{
  "module": "node18",
  "moduleResolution": "node16",
  "experimentalDecorators": true,
  "emitDecoratorMetadata": true,
  "isolatedModules": true,
  "strict": true,
  "rootDir": "src",
  "outDir": "dist"
}
```

- `moduleResolution: "node"`(node10)는 TS 6/7에서 제거되었다. `node16`을 쓴다.
- `rootDir`을 명시하지 않으면 TS 6이 `TS5011`로 거부한다.
- 하이브리드 module kind는 `isolatedModules: true`를 요구한다 (ts-jest `TS151002`).
- ESM이므로 **모든 상대 import에 `.js` 확장자를 붙인다**. 이 제약은 README와 `AGENTS.md`에 명시한다.

## 3. 디렉터리 구조

참조 템플릿의 `app/` · `config/` · `db/` 삼분 구조를 `src/` 아래에 1:1로 옮긴다.

```text
src/app/controllers/concerns/          # CrudActions mixin과 하위 책임 분할
src/app/controllers/api/v1/            # 리소스 선언 (examples, auth, users)
src/app/controllers/health.controller.ts
src/app/jsonapi/                       # 문서·오류·협상·현지화·조회·응답·네이밍
src/app/models/                        # TypeORM 엔티티
src/app/schemas/                       # 쓰기 DTO와 QueryPolicy
src/app/serializers/                   # 공개 응답 필드와 관계
src/app/auth/                          # 비밀번호·JWT·refresh session
src/app/jobs/                          # BullMQ 프로세서
src/config/main.ts                     # 프로세스 진입점 (= config/asgi.py)
src/config/app.module.ts               # 애플리케이션 팩토리 (= config/main.py)
src/config/routes.module.ts            # 명시적 라우트 등록 (= config/routes.py)
src/config/settings.ts                 # 환경 변수 파싱
src/config/database.ts                 # DataSource 설정
src/config/auth.ts                     # JWT 설정
src/config/broker.ts                   # Redis/BullMQ 연결 설정
src/config/data-source.ts              # TypeORM CLI 전용 DataSource
src/db/migrations/                     # TypeORM 마이그레이션
src/db/seeds.ts                        # 결정적 시드
test/                                  # 단위·PostgreSQL 통합 테스트
scripts/check.sh                       # 단일 검증 게이트
```

`config/routes.py`의 "자동 탐색 금지, 명시 등록" 계약은 Nest의 `@Module({ controllers: [...] })` 배열이 그대로 대응한다. 배열에 없는 컨트롤러는 존재하지 않는 것과 같다.

## 4. 계층 소유권

| 위치 | 소유하는 것 | 소유하지 않는 것 |
| --- | --- | --- |
| `models/` | TypeORM 엔티티, 제약조건, FK, 관계, 인덱스, 저장 enum | HTTP 입력 검증, 공개 필드 선택 |
| `schemas/` | 쓰기 DTO, camelCase alias, 관계 linkage 입력, `QueryPolicy` allowlist | ORM 저장, JSON 응답 조립 |
| `serializers/` | JSON:API `type`, attributes, relationships, include serializer, eager-load 선언 | 요청 값 검증, SQL filter 해석 |
| `controllers/api/v1/` | 자원별 선언과 필요한 도메인 훅 | CRUD 구현, 라우트 자동 등록 |

`auth/`와 `jobs/`는 인프라 모듈이며 Nest DI provider로 구성한다. **"service 계층 금지" 규칙은 리소스에 적용된다** — 리소스 컨트롤러는 `CrudActions`를 통해 ORM과 직접 대화하고, 자원별 service를 만들지 않는다.

## 5. JSON:API 프로토콜 계약

### 5.1 미디어 타입

- 모든 리소스 라우트는 `Accept: application/vnd.api+json`을 검증한다. 비호환은 `406 NOT_ACCEPTABLE`.
- 본문이 있는 요청은 `Content-Type: application/vnd.api+json`을 요구한다. 위반은 `415 UNSUPPORTED_MEDIA_TYPE`.
- 협상을 생략하는 컨트롤러는 `negotiateAccept = false`로, 루트 마운트 컨트롤러는 `allowRootPrefix = true`로 의도를 코드에 남긴다.

Express body parser에 `type: 'application/vnd.api+json'`을 등록한다.

### 5.2 오류

참조와 동일한 24개 코드를 유지한다.

```text
NOT_ACCEPTABLE, UNSUPPORTED_MEDIA_TYPE, INVALID_JSONAPI_DOCUMENT,
INVALID_QUERY_PARAMETER, INVALID_FILTER, INVALID_SORT, INVALID_INCLUDE,
INVALID_PAGE, RESOURCE_NOT_FOUND, RELATIONSHIP_RESOURCE_NOT_FOUND,
TYPE_MISMATCH, ID_MISMATCH, CLIENT_GENERATED_ID_UNSUPPORTED,
RESOURCE_CONFLICT, VALIDATION_ERROR, INTERNAL_SERVER_ERROR, HTTP_ERROR,
AUTHENTICATION_REQUIRED, INVALID_CREDENTIALS, INVALID_TOKEN,
TOKEN_EXPIRED, TOKEN_REVOKED, USER_INACTIVE, EMAIL_ALREADY_REGISTERED
```

- `ERROR_CATALOG`가 코드 → (ko 메시지, en 메시지, HTTP status)를 소유한다.
- 전역 `JsonApiExceptionFilter`가 모든 오류를 JSON:API 오류 문서로 변환한다. Nest 기본 오류 형식은 외부로 나가지 않는다.
- `Accept-Language` 해석은 품질값(`q`)과 명시도를 고려하며 기본값은 `ko`다. 참조의 `resolve_language` 알고리즘을 그대로 옮긴다.
- 오류 객체는 `code`와 `source`(pointer 또는 parameter)를 보존한다.

### 5.3 응답

- 성공·오류 모두 `Content-Type: application/vnd.api+json`으로 응답한다.
- `POST`·`PUT` 생성은 `Location` 헤더를 낸다. 기준값은 시리얼라이저의 `resourcePath`다.
- 관계 mutation은 `204 No Content`.

## 6. CrudActions mixin 설계

### 6.1 공개 형태

```ts
@Controller('api/v1/examples')
export class ExamplesController extends CrudActions({
  model: Example,
  serializer: ExampleSerializer,
  createSchema: ExampleCreate,
  updateSchema: ExampleUpdate,
  replaceSchema: ExampleReplace,
  relationshipsSchema: ExampleRelationships,
  queryPolicy: EXAMPLE_QUERY_POLICY,
  enableUpsert: true,
  writeGuards: [JwtActiveUserGuard],
}) {}
```

참조는 `config/routes.py`에서 `prefix=`를 넘겨 라우트를 조립하지만, Nest는 경로가 `@Controller(path)` 메타데이터에서 나온다. 따라서 prefix는 컨트롤러 데코레이터가 소유하고, **시리얼라이저의 `resourcePath`와 문자열까지 같아야 한다**. 이 값이 `self` 링크와 `POST`·`PUT`의 `Location` 기준이기 때문이다.

참조는 이 불일치를 감지하지 않아 잘못된 링크가 조용히 나가는 구조였다. 이 템플릿은 `CrudActions` 팩토리가 조립 시점에 `@Controller` 경로와 `serializer.resourcePath`를 비교해 어긋나면 즉시 예외를 던진다. 조용한 실패를 하나 줄이는 의도적 개선이다.

### 6.2 concern 분할

참조의 파일 분할을 유지한다. 공개 진입점은 `CrudActions` 하나이며 상속 체인은 항상 아래 방향으로만 참조한다.

| 파일 | 책임 |
| --- | --- |
| `jsonapi-controller.ts` | prefix 검증, 협상 정책 선언 |
| `crud-base.ts` | 선언 계약, `before*`/`after*` 훅 |
| `document-parsing.ts` | 요청 문서 파싱·검증, `presentKeys` 캡처 |
| `route-registrar.ts` | 라우트·OpenAPI responses·delegate 등록 |
| `relationship-resolver.ts` | linkage 해석과 관계 액션 |
| `upsert-executor.ts` | `PUT` upsert |
| `crud-actions.ts` | 조립과 index/show/create/update/destroy |

### 6.3 라우트 생성 메커니즘 (검증됨)

정적 액션은 팩토리 내부 클래스에 데코레이터로 선언한다. 관계 라우트는 개수가 가변이므로 시리얼라이저의 `relationships` 선언을 읽어 프로토타입에 메서드를 정의하고 데코레이터를 함수로 호출해 적용한다.

```ts
const proto = CrudActionsHost.prototype as unknown as Record<string, unknown>;
for (const [rel, definition] of Object.entries(serializer.relationships)) {
  const name = `showLinkage$${rel}`;
  proto[name] = function (id: string) { /* ... */ };
  const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
  Get(`:id/relationships/${rel}`)(proto, name, descriptor);
  Param('id')(proto, name, 0);
}
```

이 방식이라야 OpenAPI에 `/api/v1/examples/{id}/relationships/tags`가 개별 경로로 노출되고, "선언한 관계만 라우트가 생긴다"는 계약이 스펙 수준에서 유지된다.

등록 대상은 시리얼라이저 `relationships` 키와 `relationshipsSchema` 필드의 **교집합**이다. 이름이 어긋나면 쓰기 관계 라우트가 조용히 사라지므로, 이 규칙은 라우트 조립 테스트가 고정한다.

### 6.4 FastAPI 의존성 → Nest 매핑

| 참조 | NestJS |
| --- | --- |
| base의 `Accept`/`Content-Type` 검증 | `JsonApiNegotiationGuard` |
| `register_exception_handlers` | 전역 `JsonApiExceptionFilter` |
| `write_dependencies=(get_current_active_user,)` | `writeGuards` 옵션 → 쓰기 메서드에만 프로그래매틱 `UseGuards` |
| `JsonApiResponse` | 응답 인터셉터 + vendor `Content-Type` |
| `get_session` 의존성 | 요청 스코프 `DataSource`/`EntityManager` 주입 |

## 7. 쓰기 계약

### 7.1 PATCH 부분 갱신 — 참조와의 최대 의미 차이

참조는 Pydantic의 `MISSING` sentinel로 "보내지 않은 필드"와 "`null`로 보낸 필드"를 구분한다. class-validator에는 대응물이 없다.

**해결**: `plainToInstance` 이전에 원본 `data.attributes` 객체의 키 집합을 캡처해 `presentKeys: ReadonlySet<string>`으로 액션에 전달한다. 업데이트는 `presentKeys`에 있는 필드만 반영한다.

- `whitelist: true` + `forbidNonWhitelisted: true` → Pydantic `extra="forbid"`
- `@Expose({ name })` → camelCase alias
- `@IsOptional()` → PATCH 스키마의 선택 필드

이 규칙은 `document-parsing.ts` 한 곳이 소유한다. 액션이 원본 요청 본문을 다시 읽지 않는다.

### 7.2 PUT replace / upsert

`enableUpsert = true`인 자원만 해당한다.

- PostgreSQL advisory transaction lock으로 동일 ID 동시 요청을 직렬화한다: `SELECT pg_advisory_xact_lock(hashtext($1))`
- `INSERT ... ON CONFLICT (id) DO UPDATE`의 원자성을 유지한다
- 생성은 `201` + `Location`, 교체는 `200`
- 사전 조회 기반 경쟁 회피나 SQLite 대체 구현을 넣지 않는다

### 7.3 관계 mutation

to-one은 `GET`/`PATCH`, to-many는 `GET`/`POST`/`PATCH`/`DELETE`를 등록한다. linkage 입력은 `ResourceIdentifier`만 받고 내부 FK를 공개 입력으로 만들지 않는다.

## 8. 조회 정책

### 8.1 QueryPolicy

자원별로 filter 필드와 허용 연산자, sort 열, include 경로, 기본 정렬, tie breaker를 선언한다. TypeORM `SelectQueryBuilder`로 컴파일한다.

- 연산자: `exact`, `contains`, `gt`, `gte`, `lt`, `lte`, `in`, `isNull`
- 알 수 없는 파라미터, 허용되지 않은 필드·연산자, `fields[...]`는 JSON:API 오류로 거부
- filter parser는 저장 형식에 맞게 엄격 변환한다. 사용자 입력으로 열 이름을 조합하지 않는다
- `include`는 시리얼라이저 선언과 `QueryPolicy.includes` 양쪽에서 허용되어야 한다

### 8.2 페이지네이션

목록 응답은 COUNT를 기본 실행하지 않는다. 다음 페이지 존재 여부는 요청 크기보다 한 행 더 읽어(probe) 판정한다. 한 페이지 최대 100개.

**offset 모드**

- `self`·`first`·`prev`·`next`는 `page[number]` 링크
- `page[totals]=true`를 보낸 요청만 `meta.totalCount`와 `links.last`를 받고, 모든 링크가 `page[totals]=true`를 유지한다

**cursor(keyset) 모드**

- `page[after]` / `page[before]`가 있으면 OFFSET 대신 정렬 키 비교로 자른다
- 빈 값(`page[after]=`)은 컬렉션 시작, `page[before]=`는 끝을 가리키는 진입점
- 커서는 요청의 유효 정렬(기본 정렬 또는 `sort` + tie breaker)에 묶인다
- 정렬 변경 후 커서 재사용, 손상된 커서, `after`/`before` 동시 사용, 커서와 `page[number]` 동시 사용은 모두 `400 INVALID_PAGE`
- NULL을 허용하는 정렬 컬럼은 keyset 비교로 행을 건너뛰므로 `INVALID_PAGE`로 거부

**related 자원 URL**

- to-many `GET /{id}/{rel}`은 `page[number]`/`page[size]`만 지원하고 `meta.totalCount`와 페이지 링크를 반환한다. `filter`·`sort`·`include` 미지원
- to-one `GET /{id}/{rel}`은 모든 조회 파라미터를 거부한다

### 8.3 인덱스 동기화 규칙

`QueryPolicy`에 filter·sort를 추가하거나 `defaultSort`·`tieBreaker`를 바꿀 때는 해당 컬럼 조합의 인덱스 필요 여부를 함께 판단하고, 필요하면 같은 변경에서 엔티티 인덱스 선언과 마이그레이션에 동시 반영한다. 만들지 않기로 했으면 근거를 정책 선언부 주석에 남긴다. 모든 정렬에 `id ASC`가 덧붙으므로 유용한 인덱스는 `(<column>, id)`다.

## 9. 인증

- 비밀번호: argon2, 12~128자
- access token 기본 900초, refresh token 기본 2,592,000초
- refresh token 회전 시 기존 token 즉시 폐기
- `refresh_sessions` 테이블: `expires_at`, `revoked_at`, `replaced_by_id`(`ON DELETE SET NULL`)
- 로그아웃은 제시한 refresh session만 폐기하고 `204` 반환. 이미 발급된 access token은 만료까지 유효
- token은 cookie에 저장하지 않고 JSON body로만 발급

리소스 타입: 회원가입은 `users`, 로그인은 `authCredentials`, 응답은 `authTokens`, 갱신·로그아웃은 `refreshTokens`.

라우트: `POST /api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `GET /api/v1/users/me`.

## 10. 비동기 작업

BullMQ 큐와 프로세서로 구성한다. Dramatiq actor와 동일한 계약을 유지한다.

- `processExample` — CRUD에서 자동 enqueue하지 않는다. 도메인 지점에서 명시 호출. 잘못된 UUID와 없는 Example은 경고 후 종료, 일시적 DB 오류는 최대 3회 재시도, 공개 필드는 변경하지 않는다
- `purgeExpiredRefreshSessions` — `expires_at`이 `REFRESH_SESSION_RETENTION_SECONDS`보다 오래 지난 행만 삭제. 오래된 순서로 배치마다 commit, 잠긴 행은 `SKIP LOCKED`로 건너뛴다. `ON DELETE SET NULL` cascade가 별도 행 잠금을 잡으므로 각 배치는 짧은 `lock_timeout` 아래에서 실행하고, 경합 시 실패시켜 재시도에 맡긴다

스케줄러 의존성을 추가하지 않는다. 외부 cron이 enqueue만 담당한다.

## 11. 데이터베이스 규칙

- PostgreSQL 전용. 운영 코드에 SQLite 우회 경로를 넣지 않는다
- 스키마 변경은 `src/db/migrations/`의 새 마이그레이션으로만 전달한다. `synchronize`는 모든 환경에서 `false`
- 시드는 결정적으로 유지하고 서버 시작과 분리한다. 고정 식별자와 PostgreSQL upsert를 쓴다
- DB 동작은 실제 PostgreSQL 통합 테스트로 검증한다

### 11.1 마이그레이션 명명 규약 (TypeORM 요구사항)

TypeORM은 **마이그레이션 클래스 이름 끝에 붙은 epoch millis 타임스탬프를 파싱해 정렬한다**. 없으면 `migration name is wrong. Migration class name should have a JavaScript timestamp appended.`로 실패한다.

- 파일: `src/db/migrations/<UTC yyyyMMddHHmmss>-<kebab-name>.ts`
- 클래스: `<PascalName><epochMillis>`

예: `20260828120000-create-example-resources.ts` → `export class CreateExampleResources1787918400000` (`1787918400000` = `2026-08-28T12:00:00Z`)

두 표기가 어긋나면 파일 이름 순서와 실제 실행 순서가 갈라진다. 마이그레이션 테스트가 디렉터리의 모든 파일에 대해 파일명 타임스탬프와 클래스명 타임스탬프가 같은 시각을 가리키는지 검사한다.

`up`/`down` 양방향을 손으로 마무리한다. 되돌릴 수 없는 마이그레이션은 받지 않으므로 `down()`을 비워 두지 않는다.

## 12. 설정과 환경 변수

애플리케이션 코드에 암묵적 기본값을 두지 않는다. 누락 시 변수 이름이 담긴 오류로 프로세스가 시작되지 않는다 (`DATABASE_URL is required`, `DB_POOL_MAX must be an integer`).

| 변수 | 필요한 프로세스 | 기본값 | 비고 |
| --- | --- | --- | --- |
| `DATABASE_URL` | API, worker, 마이그레이션, 시드 | 없음(필수) | `postgres://user:pass@host:5432/db` |
| `REDIS_URL` | worker | 없음(필수) | API는 broker를 import하지 않는다 |
| `JWT_SECRET_KEY` | API | 없음(필수) | UTF-8 최소 32바이트 |
| `PORT` | API | `4000` | |
| `DB_POOL_MAX` | DB 접속 프로세스 | `10` | |
| `DB_POOL_IDLE_TIMEOUT_MS` | DB 접속 프로세스 | `30000` | |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | DB 접속 프로세스 | `30000` | |
| `JWT_ISSUER` / `JWT_AUDIENCE` | API | `template-typescript-nestjs` | |
| `JWT_ACCESS_EXPIRES_SECONDS` | API | `900` | |
| `JWT_REFRESH_EXPIRES_SECONDS` | API | `2592000` | |
| `JWT_LEEWAY_SECONDS` | API | `0` | |
| `REFRESH_SESSION_RETENTION_SECONDS` | worker | `604800` | 음수는 거부 |

**참조와의 의도적 차이**: 참조의 `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`/`DB_POOL_TIMEOUT`은 SQLAlchemy 풀 모델 전용이다. node-postgres에는 overflow 개념이 없으므로 위 3개로 대체한다. `DATABASE_URL`의 스킴도 `postgresql+psycopg://`가 아니라 `postgres://`다.

`@nestjs/config` 대신 손으로 쓴 `settings.ts`를 쓴다. 참조가 암묵적 기본값을 의도적으로 배제하고 변수명이 담긴 오류를 내는 계약을 그대로 재현하기 위해서다.

## 13. 검증 게이트

`scripts/check.sh`가 단일 진입점이다. CI와 로컬이 갈라지지 않게 CI도 이 스크립트를 호출한다.

동작 순서:

1. `TEST_DATABASE_URL`이 없으면 `docker-compose.test.yml`로 임시 PostgreSQL을 임의 포트에 기동
2. `eslint .`
3. `prettier --check .`
4. `tsc --noEmit`
5. `jest` (커버리지 게이트 80%)
6. `secretlint`
7. `trap`으로 임시 DB 정리

전체 검증 명령 (README의 `## 검증` 절과 문자열 단위로 동일하게 유지하며, 문서 테스트가 이를 고정한다):

```bash
pnpm install --frozen-lockfile
./scripts/check.sh
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

### 13.1 npm scripts (참조의 poe 태스크 대응)

| script | 실행 내용 |
| --- | --- |
| `lint` / `format` / `format:check` | `eslint .` / `prettier --write .` / `prettier --check .` |
| `typecheck` | `tsc --noEmit` |
| `build` | `tsc` (`dist/` 산출) |
| `start` / `start:dev` | `node dist/config/main.js` / watch 모드 |
| `test` | `jest` (커버리지 게이트 포함) |
| `test:jsonapi` / `test:controllers` / `test:db` | 좁은 Jest 경로 실행 |
| `migrate` / `seed` | TypeORM 마이그레이션 / `node dist/db/seeds.js` |
| `db:up` / `worker` / `compose:verify` | Compose 서비스 기동과 설정 검증 |
| `check` | `./scripts/check.sh` 호출만 한다 |

`check`를 제외한 태스크는 bash 없이 Windows에서도 동작한다. `check`는 bash 스크립트이므로 Git Bash 또는 WSL이 필요하다.

Jest는 ESM이므로 `NODE_OPTIONS=--experimental-vm-modules`가 필요하다.

## 14. 문서 구조

참조와 동일한 문서군을 한국어로 작성한다.

| 경로 | 소유하는 로컬 계약 |
| --- | --- |
| `README.md` | 실행·환경 변수·API 사용·새 리소스 추가·검증 |
| `AGENTS.md` | 아키텍처·DB 규칙·검증 명령·조립점과 변경 순서 |
| `src/config/AGENTS.md` | 팩토리·명시 route·DataSource 조립 |
| `src/db/AGENTS.md` | 호출자 소유 트랜잭션의 결정적 seed |
| `src/db/migrations/AGENTS.md` | DataSource 선택과 up/down |
| `src/app/AGENTS.md` | 모델·schema·serializer·controller 계층 책임 |
| `src/app/jsonapi/AGENTS.md` | 프로토콜 계약 |
| `src/app/serializers/AGENTS.md` | 공개 표현 규칙 |
| `src/app/controllers/concerns/AGENTS.md` | 공통 CRUD 계약과 concern별 검토 지점 |
| `test/AGENTS.md` | fixture와 계약별 회귀 테스트 배치 |

`docs/superpowers/specs/`와 `docs/superpowers/plans/`에 이 스펙과 구현 계획을 둔다.

## 15. 테스트 전략

참조는 소스 6,681줄에 테스트 12,729줄이다. 같은 비율을 목표로 한다.

- 실제 PostgreSQL로 검증한다. 인메모리 SQLite, 모델 mock, DB 없는 컨트롤러 단위 테스트로 마이그레이션·관계·upsert 계약을 대체하지 않는다
- `TEST_DATABASE_URL`을 필수로 요구하고 DB 이름이 `_test`로 끝나는지 확인한다
- 마이그레이션 `head`까지 올린 DB를 fixture로 제공한다
- 각 테스트는 트랜잭션 + savepoint로 롤백한다. commit 관찰과 동시성 테스트는 별도 fixture를 쓴다
- 애플리케이션 조립은 `test/` 공용 팩토리 한 곳에만 둔다

배치:

| 경로 | 검증 대상 |
| --- | --- |
| `test/jsonapi/` | 문서 불변조건, 협상, 오류, query parser, 응답 헤더 |
| `test/controllers/` | `CrudActions`, 관계 mutation, upsert와 롤백·동시성 |
| `test/models/`, `test/serializers/` | 제약·관계와 공개 표현 |
| `test/config/`, `test/integration/` | 설정, 마이그레이션 적용, 결정적 seed |
| `test/*.controller.spec.ts` | 실제 팩토리, 명시 route, JSON:API wire 응답 |
| `test/docs/` | README와 AGENTS.md의 명령 문자열 동기화 |
| `test/scripts/` | `scripts/check.sh`의 검증·정리 동작 |

회귀 작성 규칙:

- HTTP 변경은 status, `Content-Type`, top-level 모양, 오류 code와 source를 함께 단언한다. `Accept-Language`를 건드리면 ko/en 모두 확인한다
- 새 query 허용 항목은 정상 요청과 거부 요청을 모두 작성한다
- 관계 변경은 cardinality, linkage type·id 오류, 없는 대상, 204, 롤백을 다룬다
- `PUT` 변경은 201+`Location`, 200 교체, 동일 ID 동시 요청, 관계 reset, 훅/직렬화 실패 롤백을 PostgreSQL에서 검증한다

## 16. 공개 API 표면

포트 4000. OpenAPI 문서 `/api-docs`, 스키마 `/api/schema`. 상태 확인 `/health/live`, `/health/ready`.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| `GET` | `/api/v1/examples` | 목록 |
| `POST` | `/api/v1/examples` | 생성 |
| `GET` | `/api/v1/examples/{id}` | 단건 조회 |
| `PATCH` | `/api/v1/examples/{id}` | 일부 수정 |
| `PUT` | `/api/v1/examples/{id}` | 전체 교체 또는 같은 ID upsert |
| `DELETE` | `/api/v1/examples/{id}` | 삭제 |
| `GET`/`PATCH` | `/api/v1/examples/{id}/relationships/category` | category linkage |
| `GET` | `/api/v1/examples/{id}/category` | 연결된 category |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/v1/examples/{id}/relationships/tags` | tags linkage |
| `GET` | `/api/v1/examples/{id}/tags` | 연결된 tags |

Example 읽기는 공개, 쓰기와 관계 변경은 활성 사용자의 Bearer access token을 요구한다.

## 17. 구현 단계

각 단계는 자체 테스트를 동반하며, 끝날 때 `./scripts/check.sh`를 통과해야 한다.

| Phase | 내용 |
| --- | --- |
| 0 | 툴체인(pnpm/TS 6/ESM/ESLint/Prettier/Jest/secretlint/husky), `scripts/check.sh`, Docker/Compose 골격, health 컨트롤러, `@nestjs/swagger` 데코레이터 방식 확인 |
| 1 | JSON:API 프로토콜 — 문서 모델, 오류 카탈로그, 협상, 현지화, 응답, 예외 필터 |
| 2 | 모델·마이그레이션·시드, DataSource 설정, PostgreSQL 테스트 fixture |
| 3 | 시리얼라이저, `QueryPolicy`, 조회 컴파일(필터/정렬/포함), 페이지네이션 2종 |
| 4 | `CrudActions` — index/show/create/update/destroy, 관계 라우트 등록 |
| 5 | `PUT` upsert (advisory lock + ON CONFLICT), 동시성 회귀 |
| 6 | 인증 — argon2, JWT, refresh session 회전, users/auth 컨트롤러 |
| 7 | BullMQ 잡 — `processExample`, `purgeExpiredRefreshSessions` |
| 8 | Docker/Compose/CI 마감, README와 `AGENTS.md` 문서군, 문서 동기화 테스트 |

## 18. 리스크

| 리스크 | 대응 |
| --- | --- |
| `@nestjs/swagger` CLI 플러그인은 webpack 빌드를 전제한다. 이 템플릿은 `tsc` 빌드다 | 플러그인을 쓰지 않고 `@ApiProperty`를 명시적으로 작성한다. Phase 0에서 확인 |
| Jest ESM은 `--experimental-vm-modules`가 필요하다 | 프로브에서 동작 확인. `NODE_OPTIONS`를 npm script에 고정 |
| TypeScript 7로 올리면 ts-jest·typescript-eslint가 동작하지 않는다 | TS 6.0.3에 고정하고, 상향은 두 도구가 TS 7 API를 지원한 뒤로 미룬다. 이 결정을 `AGENTS.md`에 근거와 함께 남긴다 |
| ESM에서 상대 import의 `.js` 확장자 누락 | 별도 조치 불필요. `"type": "module"` + `moduleResolution: node16`이면 `tsc`가 `TS2835`로 직접 거부한다(실측 확인). `typecheck`가 게이트 역할을 하므로 ESLint 플러그인을 추가하지 않고, 제약만 README·`AGENTS.md`에 명시한다 |
| TypeORM 1.x는 최근 메이저 릴리스라 문서·예제가 0.3.x 기준인 경우가 많다 | 마이그레이션·QueryBuilder 계약을 Phase 2·3의 실제 PostgreSQL 테스트로 고정한다 |
