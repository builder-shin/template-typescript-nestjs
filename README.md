# TypeScript NestJS Template

NestJS 12, TypeORM, PostgreSQL로 구성한 JSON:API 1.1 템플릿입니다. 현재 Phase 0-3(기반, JSON:API 프로토콜, 영속성 계층, 시리얼라이저와 조회 정책)까지 구현되어 있습니다.

## 요구 사항

- Node.js 24.11.0 이상
- pnpm 11
- Docker (검증 게이트와 Compose 스택에 필요합니다)

## 환경 변수

애플리케이션 코드에 암묵적 기본값을 두지 않습니다. 필수 값이 없으면 변수 이름이 담긴 오류로 프로세스가 시작되지 않습니다.

| 변수                            | 필요한 프로세스         | 기본값                      | 비고                                |
| ------------------------------- | ----------------------- | --------------------------- | ----------------------------------- |
| `DATABASE_URL`                  | API, 마이그레이션, 시드 | 없음(필수)                  | `postgres://user:pass@host:5432/db` |
| `PORT`                          | API                     | `4000`                      |                                     |
| `DB_POOL_MAX`                   | DB 접속 프로세스        | `10`                        | 1 이상                              |
| `DB_POOL_IDLE_TIMEOUT_MS`       | DB 접속 프로세스        | `30000`                     |                                     |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | DB 접속 프로세스        | `30000`                     |                                     |
| `TEST_DATABASE_URL`             | 테스트                  | 없음(`check.sh`가 만듭니다) | DB 이름이 `_test`로 끝나야 합니다   |

`TEST_DATABASE_URL`의 `_test` 접미사 검사는 사고 방지 장치입니다. 테스트는 `TRUNCATE`를 실행하므로 이 변수를 개발 DB로 두면 데이터가 사라집니다.

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
src/app/                # 컨트롤러와 JSON:API 미디어 타입 상수
src/app/jsonapi/        # JSON:API 프로토콜 — 오류·언어·문서·협상·필터·응답
src/app/models/         # TypeORM 엔티티
src/app/schemas/        # 조회 정책 (filter·sort·include allowlist)
src/app/serializers/    # 공개 표현 (JSON:API type·attributes·relationships)
src/config/             # 조립점 (앱 모듈, 명시 라우트, 설정, OpenAPI)
src/config/database.ts  # DataSource 조립
src/db/migrations/      # 마이그레이션 (명시 등록)
src/db/seeds.ts         # 결정적 시드
test/                   # 단위 테스트
scripts/check.sh        # 단일 검증 게이트
```

Phase 0-3까지 구현되어 있습니다: 기반과 검증 게이트, JSON:API 프로토콜 계층(협상·문서·오류·언어), 영속성 계층(TypeORM 엔티티·마이그레이션·시드), 시리얼라이저와 조회 정책입니다. `scripts/check.sh`가 실제 PostgreSQL 테스트 DB에 연결해 확인합니다. 아직 구현되지 않은 것은 선언형 CRUD(`CrudActions`), 인증, 비동기 작업입니다. 전체 설계는 `docs/superpowers/specs/`를 참고하세요.

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

## Docker로 실행

```bash
docker compose up -d --build --wait
curl -s http://localhost:4000/health/ready
docker compose down -v
```

## Docker Compose 환경 변수

Compose 스택(`docker-compose.yml`)이 셸 기본값 문법(`${VAR:-default}`)으로 자체 처리하는 변수입니다. 위 애플리케이션 환경 변수와는 별개입니다.

| 변수                | 기본값            | 비고                                                                                                                                    |
| ------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`              | `4000`            | 정수가 아니면 `PORT must be an integer`로 실패합니다. Compose는 이 값을 호스트에도 그대로 게시하고 컨테이너 헬스체크도 이 값을 따릅니다 |
| `POSTGRES_DB`       | `nestjs_template` | Compose 전용입니다                                                                                                                      |
| `POSTGRES_USER`     | `nestjs`          | Compose 전용입니다                                                                                                                      |
| `POSTGRES_PASSWORD` | `nestjs`          | Compose 전용 개발 값입니다                                                                                                              |

## 개별 검사

```bash
pnpm build            # tsc -p tsconfig.build.json
pnpm start            # node dist/config/main.js
pnpm lint             # eslint .
pnpm format           # prettier --write .
pnpm format:check     # prettier --check .
pnpm typecheck        # tsc --noEmit -p tsconfig.json
pnpm test             # jest (커버리지 게이트 80% 포함)
pnpm test:quick       # jest (커버리지 없이 빠르게)
pnpm test:jsonapi     # jest test/jsonapi (커버리지 없이)
pnpm test:controllers # jest test/controllers (Phase 4에서 경로가 생깁니다)
pnpm test:db          # jest test/integration test/db test/models (커버리지 없이)
pnpm secretlint       # 비밀 정보 탐지
pnpm check            # ./scripts/check.sh 전체 게이트
pnpm migrate          # typeorm migration:run -d dist/config/data-source.js
pnpm seed             # node dist/db/seeds.js
pnpm db:up            # docker compose up -d --wait db
```

`check`를 제외한 모든 태스크는 bash 없이 Windows에서 동작합니다. `check`는 bash 스크립트이므로 Git Bash 또는 WSL이 필요합니다.

## 검증

전체 검사는 격리된 실제 PostgreSQL 테스트 DB를 자동으로 실행하고 정리합니다.

```bash
pnpm install --frozen-lockfile
./scripts/check.sh
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

검사 범위는 ESLint, Prettier, strict TypeScript, Jest와 커버리지, 비밀 정보 탐지입니다. 타입 검사는 `src`뿐 아니라 `test`까지 포함합니다.
