# TypeScript NestJS Template

NestJS 12, TypeORM, PostgreSQL로 구성한 JSON:API 1.1 템플릿입니다. Phase 0-8(기반, JSON:API 프로토콜, 영속성 계층, 시리얼라이저와 조회 정책, 선언형 CRUD, `PUT` 업서트, 인증, 비동기 작업, Docker/CI와 문서화)을 모두 구현했습니다.

## 요구 사항

- Node.js 24.11.0 이상
- pnpm 11
- Docker (검증 게이트와 Compose 스택에 필요합니다)

## 환경 변수

애플리케이션 코드에 암묵적 기본값을 두지 않습니다. 필수 값이 없으면 변수 이름이 담긴 오류로 프로세스가 시작되지 않습니다.

| 변수                                | 필요한 프로세스         | 기본값                       | 비고                                                                           |
| ----------------------------------- | ----------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                      | API, 마이그레이션, 시드 | 없음(필수)                   | `postgres://user:pass@host:5432/db`                                            |
| `REDIS_URL`                         | 워커                    | 없음(필수)                   | API는 이 값을 읽지 않습니다 — broker를 import하지 않으므로 Redis 없이도 뜹니다 |
| `JWT_SECRET_KEY`                    | API                     | 없음(필수)                   | UTF-8 최소 32바이트                                                            |
| `PORT`                              | API                     | `4000`                       |                                                                                |
| `DB_POOL_MAX`                       | DB 접속 프로세스        | `10`                         | 1 이상                                                                         |
| `DB_POOL_IDLE_TIMEOUT_MS`           | DB 접속 프로세스        | `30000`                      |                                                                                |
| `DB_POOL_CONNECTION_TIMEOUT_MS`     | DB 접속 프로세스        | `30000`                      |                                                                                |
| `JWT_ISSUER` / `JWT_AUDIENCE`       | API                     | `template-typescript-nestjs` |                                                                                |
| `JWT_ACCESS_EXPIRES_SECONDS`        | API                     | `900`                        | access token 수명(초)                                                          |
| `JWT_REFRESH_EXPIRES_SECONDS`       | API                     | `2592000`                    | refresh token 수명(초)                                                         |
| `JWT_LEEWAY_SECONDS`                | API                     | `0`                          | token 만료 판정의 시계 오차 허용치                                             |
| `REFRESH_SESSION_RETENTION_SECONDS` | 워커                    | `604800`                     | 음수 거부. 이보다 오래 지난 refresh session만 정리 대상입니다                  |
| `TEST_DATABASE_URL`                 | 테스트                  | 없음(`check.sh`가 만듭니다)  | DB 이름이 `_test`로 끝나야 합니다                                              |
| `TEST_REDIS_URL`                    | 테스트                  | 없음(`check.sh`가 만듭니다)  | `test/db/fixture.ts`가 요구합니다. URL 형식만 검사하고 이름 규칙은 없습니다    |

`TEST_DATABASE_URL`의 `_test` 접미사 검사는 사고 방지 장치입니다. 테스트는 `TRUNCATE`를 쓰지 않지만(예전에 있던 전체 비우기 헬퍼는 다른 스펙의 커밋 행까지 지우는 사고 때문에 제거됐습니다), 이 변수를 개발 DB로 두면 여전히 위험합니다 — 테스트 실행마다 이 DB에 마이그레이션이 그대로 적용되어 스키마가 갈아엎이고, `purgeExpiredRefreshSessions` 통합 스펙은 테스트 데이터로 좁혀지지 않는 `DELETE`로 만료된 진짜 세션까지 지웁니다. `TEST_REDIS_URL`에는 같은 이름 규칙을 걸 수 없습니다 — Redis 연결 URL은 호스트·포트뿐이라 "테스트 전용"을 값만 보고 판정할 방법이 없습니다.

## 데이터베이스

스키마 변경은 마이그레이션으로만 전달합니다. `synchronize`는 모든 환경에서 `false`입니다.

```bash
pnpm db:up          # 로컬 PostgreSQL 기동
pnpm build          # 마이그레이션과 시드는 dist/ 를 실행한다
pnpm migrate        # 마이그레이션을 head까지 적용
pnpm seed           # 결정적 시드 적용 (몇 번을 돌려도 결과가 같다)
```

새 마이그레이션의 파일명은 `<UTC yyyyMMddHHmmss>-<kebab-name>.ts`, 클래스명은 `<PascalName><epochMillis>`이며 두 타임스탬프가 같은 시각을 가리켜야 합니다. 만든 뒤 `src/db/migrations/index.ts`의 `MIGRATIONS` 배열에 추가합니다 — 배열에 없는 마이그레이션은 실행되지 않습니다. `test/db/migration-naming.spec.ts`가 이 두 규칙을 고정합니다.

## 구조

```text
src/app/                # 애플리케이션 계층 루트(직접 소유한 파일 없음, 아래 하위 디렉터리로 구성)
src/app/auth/           # 비밀번호 해시(argon2)·JWT 발급/검증·refresh session 회전
src/app/controllers/concerns/  # CrudActions mixin과 하위 책임 분할
src/app/controllers/api/v1/    # 리소스 선언
src/app/jobs/            # BullMQ 잡 핸들러(processExample·purgeExpiredRefreshSessions)와 독립 워커 진입점
src/app/jsonapi/        # JSON:API 프로토콜 — 오류·언어·문서·협상·필터·응답
src/app/models/         # TypeORM 엔티티
src/app/schemas/        # 쓰기 DTO, 관계 linkage 입력, QueryPolicy allowlist
src/app/serializers/    # 공개 표현 (JSON:API type·attributes·relationships)
src/config/             # 조립점 (앱 모듈, 명시 라우트, 설정, OpenAPI)
src/config/database.ts  # DataSource 조립
src/db/migrations/      # 마이그레이션 (명시 등록)
src/db/seeds.ts         # 결정적 시드
test/                   # 단위·통합 테스트 (test/integration/은 실제 PostgreSQL·Redis로 검증)
scripts/check.sh        # 단일 검증 게이트
```

Phase 0-8을 모두 구현했습니다: 기반과 검증 게이트, JSON:API 프로토콜 계층(협상·문서·오류·언어), 영속성 계층(TypeORM 엔티티·마이그레이션·시드), 시리얼라이저와 조회 정책, 선언형 CRUD(`CrudActions`), `PUT` 업서트(동일 id 동시 요청을 advisory 잠금으로 직렬화하는 생성/교체), 인증(argon2 비밀번호, JWT access/refresh, refresh session 회전, `GET /api/v1/users/me`, Example 쓰기 보호), 비동기 작업(BullMQ 큐, `processExample`, `purgeExpiredRefreshSessions`, 독립 워커 진입점), 그리고 Docker/Compose/CI 마감과 루트 + 계층별 `AGENTS.md` 문서군입니다. `scripts/check.sh`가 실제 PostgreSQL과 실제 Redis에 연결해 확인합니다. 이 템플릿이 의도적으로 채택하지 않은 것(리소스별 repository/service 계층, `fields[...]` 희소 필드셋, GraphQL/WebSocket, 멀티테넌시, 스케줄러 의존성 등)은 스펙 1.1절의 비목표를 참고하세요. 전체 설계는 `docs/superpowers/specs/`를 참고하세요.

## ESM 제약

이 템플릿은 ESM 패키지입니다(`"type": "module"`). NestJS 12가 ESM 전용이라 선택이 아니라 전제입니다.

**모든 상대 import에 `.js` 확장자를 붙여야 합니다.**

```ts
import { AppModule } from './app.module.js'; // 올바름
import { AppModule } from './app.module'; // TS2835 오류
```

`pnpm typecheck`가 이 규칙의 게이트입니다. 별도 린트 규칙은 두지 않습니다.

TypeScript는 6.0.3에 고정되어 있습니다. 7.x는 네이티브 컴파일러라 JS 컴파일러 API를 노출하지 않아 `ts-jest`와 `typescript-eslint`가 동작하지 않습니다.

이 저장소는 `.gitattributes`로 줄바꿈을 LF로 고정합니다. Windows에서는 Git for Windows의 시스템 기본 설정인 `core.autocrlf=true`를 따르면 체크아웃 시 텍스트 파일이 CRLF로 바뀌는데, Prettier의 기본값인 `endOfLine: "lf"` 검사가 이를 오류로 처리합니다. 그러면 새로 클론한 환경에서 `pnpm format:check`가, 나아가 이를 포함하는 `scripts/check.sh` 게이트가 곧바로 깨집니다.

## 로컬 실행

```bash
pnpm install
pnpm build
pnpm start
```

- API: `http://localhost:4000`
- OpenAPI 문서: `http://localhost:4000/api-docs`
- OpenAPI 스키마: `http://localhost:4000/api/schema`
- 상태 확인: `http://localhost:4000/health/live`, `http://localhost:4000/health/ready`

## 백그라운드 작업

공통 작업 설정은 최초 실행과 재시도 3회(총 4회)입니다. n번째 재시도는 `15 * 2**(n-1)`초에 `0..(10*n-1)` 범위에서 균등하게 뽑은 정수 초를 더해 기다립니다. 따라서 대기는 차례로 15–24초, 30–49초, 60–89초입니다. 만료 세션 정리는 기본 배치당 1,000건, 실행당 최대 10,000배치이며 DB 잠금 대기 상한은 2,000ms입니다.

직접 호출의 배치 크기는 `1..9007199254740991`의 정수 값인 숫자만 허용하며 `1.0`도 허용합니다. 문자열·불리언·범위 밖 값은 DB에 접근하지 않고 `{ deleted: 0, batches: 0 }`으로 종료합니다. 결과는 삭제 수 `deleted`와 실행한 배치 수 `batches`이며, 마지막 빈 배치도 셉니다.

BullMQ 큐(`jobs`) 하나에 잡 두 개가 올라갑니다. **CRUD는 이 잡들을 자동으로 enqueue하지 않습니다** — 쓰기 한 번을 잡 하나에 묶으면 대량 갱신 한 번이 큐를 채우게 되므로, enqueue는 항상 도메인 지점에서 명시적으로 호출합니다.

- `processExample` — Example 하나를 조회해 로그만 남기고 아무것도 쓰지 않습니다(공개 필드 불변). 가리킬 수 없는 id나 이미 지워진 행은 경고 후 정상 종료하고, 일시적 DB 오류는 최대 3회 재시도합니다.
- `purgeExpiredRefreshSessions` — `REFRESH_SESSION_RETENTION_SECONDS`보다 오래 지난 refresh session을 오래된 순서로, 배치마다 commit하며 삭제합니다. **이 저장소는 반복 잡을 스케줄링하지 않습니다** — 이 잡을 주기적으로 enqueue하는 것은 외부 cron의 몫입니다.

워커는 API와 분리된 프로세스입니다. Nest 애플리케이션을 부팅하지 않고 `DataSource`만 직접 만들어 큐에 붙습니다. `pnpm build`로 만든 `dist/`를 그대로 씁니다(위 로컬 실행 절과 같습니다).

워커는 PostgreSQL과 Redis 둘 다 필요합니다. 먼저 두 서비스를 띄우세요 — `db`만 띄우는 `pnpm db:up`으로는 부족합니다.

```bash
docker compose up -d --wait db redis
pnpm worker    # node dist/app/jobs/worker.js
```

`REDIS_URL`(필수)과 `REFRESH_SESSION_RETENTION_SECONDS`(선택, 기본 604800초)는 워커 전용입니다. API 프로세스는 이 값을 읽지 않고 broker를 import하지도 않으므로, API만 띄운다면 Redis가 없어도 됩니다. 기본값은 위 환경 변수 표를 참고하세요.

## 공개 API 표면

| 메서드                        | 경로                                           | 동작                  | 인증                            |
| ----------------------------- | ---------------------------------------------- | --------------------- | ------------------------------- |
| `GET`                         | `/api/v1/examples`                             | 목록                  | 공개                            |
| `POST`                        | `/api/v1/examples`                             | 생성                  | 활성 사용자 Bearer token 필요   |
| `GET`                         | `/api/v1/examples/{id}`                        | 단건 조회             | 공개                            |
| `PATCH`                       | `/api/v1/examples/{id}`                        | 일부 수정             | 활성 사용자 Bearer token 필요   |
| `PUT`                         | `/api/v1/examples/{id}`                        | 전체 교체 또는 upsert | 활성 사용자 Bearer token 필요   |
| `DELETE`                      | `/api/v1/examples/{id}`                        | 삭제                  | 활성 사용자 Bearer token 필요   |
| `GET`/`PATCH`                 | `/api/v1/examples/{id}/relationships/category` | category linkage      | `GET` 공개, `PATCH` 인증 필요   |
| `GET`                         | `/api/v1/examples/{id}/category`               | 연결된 category       | 공개                            |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/v1/examples/{id}/relationships/tags`     | tags linkage          | `GET` 공개, 나머지 인증 필요    |
| `GET`                         | `/api/v1/examples/{id}/tags`                   | 연결된 tags           | 공개                            |
| `GET`                         | `/api/v1/categories`                           | 분류 목록             | 공개                            |
| `GET`                         | `/api/v1/categories/{id}`                      | 분류 단건             | 공개                            |
| `GET`                         | `/api/v1/tags`                                 | 라벨 목록             | 공개                            |
| `GET`                         | `/api/v1/tags/{id}`                            | 라벨 단건             | 공개                            |
| `POST`                        | `/api/v1/auth/register`                        | 회원가입              | 공개                            |
| `POST`                        | `/api/v1/auth/login`                           | 로그인                | 공개                            |
| `POST`                        | `/api/v1/auth/refresh`                         | token 갱신(세션 회전) | 공개(유효한 refresh token 필요) |
| `POST`                        | `/api/v1/auth/logout`                          | 로그아웃              | 공개(유효한 refresh token 필요) |
| `GET`                         | `/api/v1/users/me`                             | 자기 자신 조회        | 활성 사용자 Bearer token 필요   |

Example 읽기(`index`/`show`, 관계 `GET`)는 공개이고, 쓰기와 관계 변경은 `POST /api/v1/auth/login`이 발급한 access token을 `Authorization: Bearer <token>`으로 실어야 합니다. 토큰이 없으면 `401 AUTHENTICATION_REQUIRED`, 비활성 사용자의 토큰이면 `403 USER_INACTIVE`입니다.

## API 사용

모든 `/api/v1` 요청에 `Accept: application/vnd.api+json`을 붙이고, 본문이 있는 요청에는 `Content-Type`도 같은 값을 붙입니다. **틀린 헤더가 가장 흔한 첫 걸림돌입니다** — `Accept`를 **다른** 타입으로 보내면 `406 NOT_ACCEPTABLE`입니다(헤더가 없거나 `*/*`이면 통과하므로, 헤더 없는 curl은 그냥 동작합니다). `Content-Type`은 **본문이 있는 요청**이면 메서드와 무관하게 이 값이어야 하고, 다르거나 빠지면 `415 UNSUPPORTED_MEDIA_TYPE`입니다 — 본문을 싣는 관계 `DELETE`도 포함입니다. `POST`·`PUT`·`PATCH`는 본문이 필수라 언제나 요구하고, 본문 없는 `GET`·`DELETE`는 이 헤더를 보지 않습니다. JSON:API 1.1은 이 미디어 타입에 파라미터를 금지하므로 `; charset=utf-8`을 붙이면 그것도 거부됩니다.

`/health/live`와 `/health/ready`도 JSON:API 문서(`data: null`, `meta.status: "ok"`, `jsonapi.version: "1.1"`)를 반환합니다. 상태 확인 요청은 Accept 협상을 생략하며, DB 연결 실패 시 readiness는 503을 반환합니다.

아래 예시의 `-g`(`--globoff`)는 장식이 아닙니다. curl은 URL의 `[]`와 `{}`를 자기 글로빙 문법으로 먼저 해석합니다 — `page[size]`는 `curl: (3) bad range`로 요청 자체가 나가지 않고, 자리표시자 `{id}`는 **조용히** `id`로 바뀌어 엉뚱한 URL로 나갑니다. JSON:API의 질의 키가 대괄호를 쓰므로 이 플래그가 필요합니다. 따옴표로는 막을 수 없습니다.

목록 — `filter`·`sort`·`page`는 자원의 조회 정책이 허용한 것만 받습니다. 허용 목록에 없으면 `400 INVALID_QUERY_PARAMETER`입니다. `sort`는 `-` 접두사가 내림차순이고 쉼표로 여러 개를 줍니다.

```bash
curl -sg -H 'Accept: application/vnd.api+json' \
  'http://localhost:4000/api/v1/examples?filter[status]=active&sort=-createdAt&page[size]=10&page[totals]=true'
```

인증 — 쓰기와 관계 변경은 활성 사용자의 access token을 요구합니다. 가입 → 로그인 순으로 토큰을 받고, 아래 쓰기 예시의 `{accessToken}`은 로그인 응답(`data.attributes.accessToken`)에서 얻습니다. access token은 기본 900초, refresh token은 기본 2,592,000초 뒤에 만료됩니다(`JWT_ACCESS_EXPIRES_SECONDS`/`JWT_REFRESH_EXPIRES_SECONDS`).

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/register \
  -H 'Accept: application/vnd.api+json' \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":{"type":"users","attributes":{"email":"user@example.test","password":"충분히-긴-비밀번호-1234"}}}'

curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Accept: application/vnd.api+json' \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":{"type":"authCredentials","attributes":{"email":"user@example.test","password":"충분히-긴-비밀번호-1234"}}}'
# => {"data":{"type":"authTokens","id":"...","attributes":{"accessToken":"{accessToken}","refreshToken":"{refreshToken}", ...}}}
```

자기 자신 조회 — 발급받은 access token으로 현재 계정을 확인합니다. 토큰이 없으면 `401 AUTHENTICATION_REQUIRED`입니다.

```bash
curl -s http://localhost:4000/api/v1/users/me \
  -H 'Accept: application/vnd.api+json' \
  -H 'Authorization: Bearer {accessToken}'
```

생성 — `201`과 `Location` 헤더를 돌려줍니다. 클라이언트가 만든 `id`는 `403`으로 거부합니다.

```bash
curl -s -X POST http://localhost:4000/api/v1/examples \
  -H 'Accept: application/vnd.api+json' \
  -H 'Content-Type: application/vnd.api+json' \
  -H 'Authorization: Bearer {accessToken}' \
  -d '{"data":{"type":"examples","attributes":{"title":"제목","description":"본문","status":"draft","score":40}}}'
```

단건 — `include`로 관계 자원을 함께 받습니다.

```bash
curl -sg -H 'Accept: application/vnd.api+json' \
  'http://localhost:4000/api/v1/examples/{id}?include=category,tags'
```

부분 수정 — 보낸 필드만 바뀝니다. 아예 보내지 않은 필드는 그대로 두고, `null`을 보내면 비웁니다. 비우기는 그 컬럼이 nullable일 때만 성립합니다 — `description`은 비워지지만 NOT NULL인 `title`·`status`·`score`에 `null`을 보내면 `422 VALIDATION_ERROR`입니다.

```bash
curl -sg -X PATCH 'http://localhost:4000/api/v1/examples/{id}' \
  -H 'Accept: application/vnd.api+json' \
  -H 'Content-Type: application/vnd.api+json' \
  -H 'Authorization: Bearer {accessToken}' \
  -d '{"data":{"type":"examples","id":"{id}","attributes":{"title":"새 제목"}}}'
```

전체 교체 — 없는 `id`면 `201`과 `Location`, 있으면 `200`으로 교체합니다. 전체 교체이므로 `PATCH`와 달리 보내지 않은 필드는 컬럼 기본값으로, 보내지 않은 관계는 빈 상태로 되돌립니다. `status`·`score`는 생성과 마찬가지로 필수라 생략할 수 없습니다. 동일 `id`로 동시에 들어온 요청은 advisory 잠금으로 직렬화되어 섞이지 않습니다.

```bash
curl -sg -X PUT 'http://localhost:4000/api/v1/examples/{id}' \
  -H 'Accept: application/vnd.api+json' \
  -H 'Content-Type: application/vnd.api+json' \
  -H 'Authorization: Bearer {accessToken}' \
  -d '{"data":{"type":"examples","id":"{id}","attributes":{"title":"제목","status":"draft","score":40}}}'
```

삭제 — `204`이고 본문이 없습니다.

```bash
curl -sg -X DELETE 'http://localhost:4000/api/v1/examples/{id}' \
  -H 'Accept: application/vnd.api+json' \
  -H 'Authorization: Bearer {accessToken}'
```

관계 교체 — 관계 라우트는 자원 문서가 아니라 linkage만 주고받고, 쓰기는 모두 `204`입니다. to-many는 `POST`로 더하고 `DELETE`로 뺍니다.

```bash
curl -sg -X PATCH 'http://localhost:4000/api/v1/examples/{id}/relationships/tags' \
  -H 'Accept: application/vnd.api+json' \
  -H 'Content-Type: application/vnd.api+json' \
  -H 'Authorization: Bearer {accessToken}' \
  -d '{"data":[{"type":"exampleTags","id":"{tagId}"}]}'
```

## 참조 자원

분류와 라벨은 읽기 전용 컬렉션으로도 조회할 수 있습니다. 관계 선택기처럼 고를 목록이
필요한 화면을 위한 것이며, 쓰기 라우트는 없습니다.

| 메서드 | 경로                      | 동작                                                             |
| ------ | ------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/api/v1/categories`      | 분류 목록 (`filter[name]` · `sort=name,createdAt` · `page[...]`) |
| `GET`  | `/api/v1/categories/{id}` | 분류 단건                                                        |
| `GET`  | `/api/v1/tags`            | 라벨 목록                                                        |
| `GET`  | `/api/v1/tags/{id}`       | 라벨 단건                                                        |

기본 정렬은 `name` 오름차순입니다. JSON:API 자원 타입은 각각 `exampleCategories`와
`exampleTags`로, URL 경로와 다릅니다. 읽기는 Example과 마찬가지로 공개이며 `include`는
지원하지 않습니다.

```bash
curl -sg -H 'Accept: application/vnd.api+json' \
  'http://localhost:4000/api/v1/categories?filter[name][contains]=문서'
```

## Docker로 실행

2026-09-11 공통 계약 변경은 새 마이그레이션으로 적용합니다. `users.email`은 254자, 카테고리·태그 이름은 200자로 맞추고 refresh session에는 토큰 SHA-256 해시를 저장합니다. 기존 refresh session은 원본 토큰 해시를 복구할 수 없어 명시적으로 폐기되며, JWT 필수 클레임 변경과 함께 기존 사용자는 다시 로그인해야 합니다. 254자를 넘는 기존 이메일이 있으면 마이그레이션이 중단되므로 해당 데이터를 먼저 정리해야 합니다.

시드는 공통 고정 ID의 카테고리 1개, 태그 1개, Example 1개를 생성합니다. 같은 값으로 다시 실행하면 타임스탬프를 유지하고, 사용자가 추가한 태그 관계와 기존 데이터는 보존합니다.

조회 시 `page[size]`는 최대 100으로 제한하며, SQL offset은 정확한 정수 계산을 위해 최대 9,007,199,254,740,991까지 허용합니다. `score` 필터는 PostgreSQL 32비트 정수 범위를 벗어나면 400을 반환합니다. 커서는 DB의 마이크로초를 보존합니다.

```bash
docker compose up -d --build --wait
curl -s http://localhost:4000/health/ready
docker compose down -v
```

**마이그레이션은 `migrate` 서비스가 적용합니다.** 스키마를 head까지 올리고 종료하는 일회성 서비스이며, `api`와 `worker`가 `service_completed_successfully`로 이것을 기다립니다. 그래서 `--wait`가 돌아온 시점에는 스키마가 이미 최신이고, 별도 명령 없이 `GET /api/v1/examples`가 동작합니다. 이미 적용된 DB에서는 `No migrations are pending`을 찍고 그대로 종료하므로 재기동해도 안전합니다.

애플리케이션이 부팅 시점에 직접 마이그레이션하지 않는 이유는 `migrationsRun`이 운영과 같이 `false`이기 때문입니다 — 복제본이 둘 이상이면 부팅 마이그레이션끼리 경합하고, 배포 단계가 소유해야 할 일이 애플리케이션 수명주기에 묶입니다.

`/health/ready`는 스키마를 보지 않습니다. 연결이 살아 있는지만 확인하므로, 마이그레이션이 적용되지 않은 DB에서도 200입니다 — 스택이 정상인지는 `--wait`가 `migrate`의 정상 종료를 기다린다는 사실이 보장합니다.

`worker` 서비스도 같이 뜹니다. 포트를 게시하지 않으므로(HTTP를 듣지 않습니다) 확인할 엔드포인트가 없습니다 — 동작은 `docker compose logs -f worker`로 봅니다. 헬스체크는 있습니다: 워커 컨테이너에서 `REDIS_URL`에 연결해 PING을 주고받습니다. 워커가 잡을 실제로 소비하고 있는지까지는 보지 않습니다.

## Docker Compose 환경 변수

Compose 스택(`docker-compose.yml`)이 셸 기본값 문법(`${VAR:-default}`)으로 자체 처리하는 변수입니다. 위 애플리케이션 환경 변수와는 별개입니다.

| 변수                | 기본값                              | 비고                                                                                                                                    |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`              | `4000`                              | 정수가 아니면 `PORT must be an integer`로 실패합니다. Compose는 이 값을 호스트에도 그대로 게시하고 컨테이너 헬스체크도 이 값을 따릅니다 |
| `REDIS_PORT`        | `6379`                              | `redis` 서비스를 호스트의 `127.0.0.1`에 게시하는 포트입니다. 로컬 6379가 이미 쓰이고 있으면 바꾸세요                                    |
| `POSTGRES_DB`       | `nestjs_template`                   | Compose 전용입니다                                                                                                                      |
| `POSTGRES_USER`     | `nestjs`                            | Compose 전용입니다                                                                                                                      |
| `POSTGRES_PASSWORD` | `nestjs`                            | Compose 전용 개발 값입니다                                                                                                              |
| `JWT_SECRET_KEY`    | 명백한 더미 값(`.env.example` 참고) | 개발용 폴백입니다. **운영에서는 반드시 실제 값으로 덮어써야 합니다**                                                                    |

## 새 리소스 추가

새 자원(예: `Article`) 하나를 추가하려면 아래 순서로 파일을 만듭니다. 이 저장소는 glob 탐색을 하지 않으므로, 파일을 만들고 나서 **레지스트리 등록을 잊으면 그 파일은 존재하지 않는 것과 같습니다** — 이 저장소가 되풀이해 겪은 실수입니다. `Example` 자원이 이 여섯 단계를 그대로 거쳐 만들어졌으므로(`src/app/models/example.entity.ts` 등), 새 자원을 만들 때 파일 하나하나를 그대로 본떠 쓸 수 있습니다.

1. **엔티티** — `src/app/models/<name>.entity.ts`에 컬럼·관계·제약·인덱스를 선언하고, **`src/app/models/index.ts`의 `ENTITIES` 배열에 등록**합니다.
2. **마이그레이션** — `src/db/migrations/`에 엔티티가 선언한 테이블·제약·인덱스를 SQL로 짓는 파일을 추가하고, **`src/db/migrations/index.ts`의 `MIGRATIONS` 배열에 등록**합니다. 파일명·클래스명 규약은 `src/db/migrations/AGENTS.md`를 따릅니다.
3. **쓰기 스키마와 조회 정책** — `src/app/schemas/`에 Create/Update DTO, 관계 쓰기 스키마, filter·sort·include allowlist를 만들고 `src/app/schemas/index.ts`에서 export합니다. `PUT`(upsert)까지 지원할 자원이면 Replace DTO도 이때 함께 만듭니다 — 5단계의 `replaceSchema`가 이것을 가리킵니다.
4. **시리얼라이저** — `src/app/serializers/`에 공개 표현(JSON:API type·attributes·relationships)을 만들고 `src/app/serializers/index.ts`에서 export합니다. 다른 자원의 관계 대상이거나 `include`로 노출된다면 `SERIALIZERS` 배열에도 등록합니다 — 이 배열은 ENTITIES·MIGRATIONS·`controllers`와 달리 런타임이 소비하지 않습니다(관계 대상은 각 시리얼라이저의 `target()`이, `included`는 `collectIncluded`가 정하고 둘 다 이 배열을 거치지 않습니다). 등록을 잊으면 그 구성을 고정하는 테스트(`test/serializers/example.serializer.spec.ts`)가 실패로 잡아 줍니다. `resourcePath`는 다음 단계 컨트롤러의 `@Controller` 경로와 문자열까지 같아야 합니다 — 다르면 부트스트랩이 즉시 예외를 던집니다.
5. **컨트롤러** — `src/app/controllers/api/v1/`에 `CrudActions`로 위 산출물을 선언만으로 잇는 파일을 만듭니다(`examples.controller.ts` 참고). 자원별 service 계층은 만들지 않습니다. 이 선언에는 기본값이 있어 빠뜨려도 조립 자체는 되지만, 그 기본값이 실제로 뜻하는 바를 모르고 빠뜨리면 안 되는 옵션이 셋 있습니다.
   - **`writeGuards`** — 기본값은 빈 배열이고, **빈 배열은 그 자원의 쓰기(및 관계 변경) 라우트를 인증 없이 공개한다는 뜻입니다.** 위 "공개 API 표면" 표처럼 활성 사용자 Bearer token을 요구하려면 `writeGuards: [JwtActiveUserGuard]`(`src/app/auth/current-user.guard.ts`)를 명시적으로 넣어야 합니다. 읽기(`index`/`show`, 관계 `GET`)는 이 값과 무관하게 항상 공개입니다.
   - **`enableUpsert`/`replaceSchema`** — `PUT`을 지원하려면 `enableUpsert: true`와 3단계에서 만든 Replace DTO를 가리키는 `replaceSchema`를 함께 선언합니다. `enableUpsert`를 켜지 않으면 `PUT`은 405로 거부되고, 켜고서 `replaceSchema`를 빠뜨리면 조립 시점(부트스트랩)에 예외가 납니다.
   - **`enableWrites`** — 읽기 전용 자원은 `enableWrites: false`를 선언합니다. `POST`/`PATCH`/`DELETE`와 관계 변경 라우트가 아예 등록되지 않고, `createSchema`·`updateSchema`·`relationshipsSchema`를 선언하지 않아도 됩니다. 기준 구현은 `src/app/controllers/api/v1/categories.controller.ts`입니다.
6. **라우트 등록** — **`src/config/routes.module.ts`의 `controllers` 배열에 추가**합니다. 여기 없으면 앞의 다섯 단계를 다 밟아도 라우트는 존재하지 않습니다.

마지막으로 새 라우트를 위 "공개 API 표면" 표에 손으로 추가하세요 — 문서 동기화 테스트(`test/docs/readme.spec.ts`)는 이 표까지는 확인하지 않으므로, 빠뜨려도 게이트는 그대로 초록입니다.

각 단계에서 정확히 무엇을 써야 하는지, 그리고 이 순서가 왜 중요한지는 `AGENTS.md`의 "조립점과 변경 순서"가 정본입니다. 계층별 세부 규칙은 아래 문서 지도를 따라가세요.

## 문서 지도

계층별 세부 계약은 각 디렉터리의 `AGENTS.md`가 소유합니다. 해당 디렉터리를 고치기 전에 먼저 읽으세요.

| 문서                                     | 언제 읽는가                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                              | 저장소 전체를 바꾸기 전에 — 아키텍처, DB 규칙, 검증 명령, ESM·TypeScript 버전 제약, 새 자원의 조립점과 변경 순서                 |
| `src/config/AGENTS.md`                   | 설정 로더·앱 조립·라우트 등록·DataSource 구성을 고칠 때                                                                          |
| `src/db/AGENTS.md`                       | 시드(`src/db/seeds.ts`)를 고칠 때 — 결정적 시드와 트랜잭션 소유권                                                                |
| `src/db/migrations/AGENTS.md`            | 마이그레이션을 추가하거나 고칠 때 — 명명 규약, `MIGRATIONS` 등록, `down()` 검증, 스키마 드리프트                                 |
| `src/app/AGENTS.md`                      | 모델·스키마의 필드 표기를 고칠 때 — nullable ↔ 검증 데코레이터 대응, 내부 FK 비공개 규칙                                         |
| `src/app/jsonapi/AGENTS.md`              | JSON:API 프로토콜 계층(협상·오류 카탈로그·문서 조립)을 고칠 때                                                                   |
| `src/app/serializers/AGENTS.md`          | 시리얼라이저의 공개 표현 규칙을 고칠 때                                                                                          |
| `src/app/controllers/concerns/AGENTS.md` | 새 자원의 컨트롤러를 선언할 때(`writeGuards`·`enableUpsert`가 실제로 무엇에 닿는지), 또는 `CrudActions` 조립 기계 자체를 고칠 때 |
| `test/AGENTS.md`                         | 테스트를 추가할 때 — fixture 격리 규율과 동시성 테스트 검증법                                                                    |

계층별 소유권 표는 루트 `AGENTS.md`의 "아키텍처" 절에, 테스트 배치 표는 스펙 15장에 있습니다 — 두 표는 여기서 반복하지 않습니다.

## 개별 검사

```bash
pnpm build            # tsc -p tsconfig.build.json
pnpm start            # node dist/config/main.js
pnpm worker           # node dist/app/jobs/worker.js
pnpm lint             # eslint .
pnpm format           # prettier --write .
pnpm format:check     # prettier --check .
pnpm typecheck        # tsc --noEmit -p tsconfig.json
pnpm test             # jest (커버리지 게이트 80% 포함)
pnpm test:quick       # jest (커버리지 없이 빠르게)
pnpm test:jsonapi     # jest test/jsonapi (커버리지 없이)
pnpm test:controllers # jest test/controllers (커버리지 없이)
pnpm test:db          # jest test/integration test/db test/models (커버리지 없이)
pnpm secretlint       # 비밀 정보 탐지
pnpm check            # ./scripts/check.sh 전체 게이트
pnpm migrate          # typeorm migration:run -d dist/config/data-source.js
pnpm seed             # node dist/db/seeds.js
pnpm db:up            # docker compose up -d --wait db
pnpm compose:verify   # docker compose config --quiet
```

`check`를 제외한 모든 태스크는 bash 없이 Windows에서 동작합니다. `check`는 bash 스크립트이므로 Git Bash 또는 WSL이 필요합니다.

## 검증

전체 검사는 격리된 실제 PostgreSQL과 실제 Redis 테스트 인스턴스를 자동으로 실행하고 정리합니다. 인프라를 목킹하지 않습니다.

```bash
pnpm install --frozen-lockfile
./scripts/check.sh
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

검사 범위는 ESLint, Prettier, strict TypeScript, Jest와 커버리지, 비밀 정보 탐지입니다. 타입 검사는 `src`뿐 아니라 `test`까지 포함합니다.
