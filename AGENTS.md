<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# template-typescript-nestjs 안내

## 목적

NestJS 기반 JSON:API 템플릿입니다. 최신 소스에는 프로토콜 처리, 선언형 CRUD,
PostgreSQL 영속성, JWT 인증, Redis/BullMQ 작업과 관련 테스트가 포함됩니다.
아래 탐색 안내에 이어 기존 `main`의 상세 계약을 보존합니다.

현재 조립에서는 인증 가드와 TokenService가 Nest provider이며, 작업 큐는
`src/app/jobs/worker.ts`의 독립 프로세스가 DataSource와 BullMQ Worker를 직접 만듭니다.
보존 원문의 `jobs/`도 Nest DI provider로 구성한다는 표현은 과거 설계 설명입니다.
현재 워커 구조와 선택 근거는 `docs/superpowers/rulings/2026-09-02-phase7-rulings.md`를 따릅니다.

## 주요 파일

| 파일                      | 설명                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| `README.md`               | 실행·환경 변수·API 사용·새 리소스 추가·검증 안내.                      |
| `package.json`            | Node >=24.11.0, pnpm 11.22.0, 의존성과 실행/검사/DB/워커 스크립트.     |
| `pnpm-lock.yaml`          | frozen 설치의 의존성 잠금 파일.                                        |
| `pnpm-workspace.yaml`     | 네이티브 빌드 허용 정책과 Jest 계열 overrides.                         |
| `tsconfig.json`           | 소스와 테스트의 strict 타입 검사, ESM 해석, 데코레이터 메타데이터.     |
| `tsconfig.build.json`     | `src/`를 `dist/`로 컴파일하는 설정.                                    |
| `jest.config.js`          | ESM 테스트, 커버리지 수집 제외 목록과 전역 80% 기준.                   |
| `eslint.config.js`        | 타입 기반 strict 린트와 명시적 반환 타입/type import 규칙.             |
| `.prettierrc.json`        | 작은따옴표·후행 쉼표·세미콜론·출력 폭 설정.                            |
| `.prettierignore`         | 생성물·잠금 파일·설계 기록 등의 포맷 검사 제외.                        |
| `.secretlintrc.json`      | secretlint 권장 규칙 설정.                                             |
| `.gitattributes`          | Windows를 포함한 텍스트 파일의 LF 줄바꿈 고정.                         |
| `.gitignore`              | 의존성·생성물·로컬 환경·실행 기록 제외.                                |
| `.env.example`            | Compose와 직접 실행용 환경 변수 예시; 앱은 dotenv를 사용하지 않습니다. |
| `Dockerfile`              | Node 24 다단계 빌드, 운영 의존성 정리, 비특권 사용자와 API 헬스체크.   |
| `.dockerignore`           | 테스트·문서·개발 산출물 등을 이미지 빌드 컨텍스트에서 제외.            |
| `docker-compose.yml`      | PostgreSQL·Redis·일회성 migrate·API·워커 서비스와 시작 의존성.         |
| `docker-compose.test.yml` | 임의 호스트 포트를 지정할 수 있는 격리 PostgreSQL/Redis 테스트 서비스. |

## 하위 디렉터리

| 디렉터리   | 역할                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| `.github/` | CI 설정. [.github/AGENTS.md](.github/AGENTS.md) 참고.                   |
| `.husky/`  | Git 훅. [.husky/AGENTS.md](.husky/AGENTS.md) 참고.                      |
| `docs/`    | 설계, 구현 계획과 결정 기록. [docs/AGENTS.md](docs/AGENTS.md) 참고.     |
| `scripts/` | 공통 검증 게이트. [scripts/AGENTS.md](scripts/AGENTS.md) 참고.          |
| `src/`     | 애플리케이션과 DB/실행 조립. [src/AGENTS.md](src/AGENTS.md) 참고.       |
| `test/`    | 단위·HTTP·인프라 통합·문서 검사. [test/AGENTS.md](test/AGENTS.md) 참고. |

## 안내 문서 관리

- 하위 AGENTS.md와 아래 기존 계약을 함께 읽습니다. 문서는 한국어, UTF-8, LF로 작성합니다.
- 재생성 시 `<!-- MANUAL` 표시 아래의 기존 지침과 수동 메모를 보존합니다.
- `node_modules/`, `dist/`, `coverage/`, `.husky/_/` 생성물과 `.superpowers/` 실행
  스크래치는 이 문서 계층의 대상에서 제외합니다.
- 문서 변경 시 `pnpm test:quick --runInBand test/docs`와 형식·링크·secretlint 검사를
  실행합니다. 전체 검증 명령과 아키텍처 규칙은 아래 기존 계약을 따릅니다.

<!-- MANUAL: 기존 main의 저장소 계약을 보존합니다. 이 줄 아래는 자동 재생성하지 않습니다. -->

# 저장소 전체 계약

이 문서는 이 저장소에서 코드를 바꾸는 모든 사람과 에이전트가 따라야 할 저장소 전체
계약을 담는다 — 아키텍처, 데이터베이스 규칙, 검증 명령, ESM·TypeScript 버전 제약,
그리고 새 자원을 더할 때 건드릴 파일과 그 순서. 실행 방법·환경 변수·API 사용법·
Docker 실행은 `README.md`가 소유한다. 계층별 세부 규칙(모델·시리얼라이저·컨트롤러
concern 등)은 스펙 14장이 정한 대로 각 디렉터리 자신의 `AGENTS.md`가 따로
소유한다.

## 아키텍처

이 저장소는 `builder-shin/template-python-fastapi`(참조 구현)의 설계 철학과 공개
계약을 NestJS로 옮긴 것이다. 포팅 대상은 코드가 아니라 계약이다 — JSON:API 1.1
프로토콜, 선언형 CRUD 컨트롤러, 계층 소유권 분리, 명시적 라우트 등록(자동 탐색
없음), 실제 PostgreSQL로 검증하는 단일 게이트, 루트 + 계층별 `AGENTS.md` 문서군을
그대로 이식했다.

계층은 넷으로 나뉜다.

| 위치                  | 소유하는 것                                               | 소유하지 않는 것               |
| --------------------- | --------------------------------------------------------- | ------------------------------ |
| `models/`             | TypeORM 엔티티, 제약조건, FK, 관계, 인덱스                | HTTP 입력 검증, 공개 필드 선택 |
| `schemas/`            | 쓰기 DTO, 관계 linkage 입력, `QueryPolicy` allowlist      | ORM 저장, JSON 응답 조립       |
| `serializers/`        | JSON:API `type`·attributes·relationships, eager-load 선언 | 요청 값 검증, SQL filter 해석  |
| `controllers/api/v1/` | 자원별 선언과 도메인 훅                                   | CRUD 구현, 라우트 자동 등록    |

**자원별 service 계층을 만들지 않는다.** "service 계층 금지" 규칙은 리소스에
적용된다 — 리소스 컨트롤러는 `CrudActions`를 통해 ORM과 직접 대화하고, 그 사이에
자원별 service를 끼우지 않는다. `auth/`와 `jobs/`는 예외다 — 이들은 특정 리소스가
아니라 인프라를 나타내므로 Nest DI provider로 구성한다. 이 결정은 참조 구현의
명시적 비목표("리소스별 repository 또는 service 계층")를 그대로 물려받은 것이다 —
service 계층을 끼워 넣으면 계층이 하나 늘면서 "컨트롤러 선언만 읽으면 그 자원의
라우트 계약을 전부 알 수 있다"는 선언형 CRUD의 핵심 가치가 깨진다.

## DB 규칙

- **스키마 변경은 `src/db/migrations/`의 새 마이그레이션으로만 전달한다.**
  `synchronize`는 모든 환경에서 `false`다. 이미 적용된 마이그레이션은 고치지
  않는다 — 고치면 그 마이그레이션을 이미 실행한 DB와 새로 만드는 DB의 스키마가
  갈라지는데, 어느 DB에 붙어 있느냐에 따라 같은 코드가 다르게 동작하는 상태가
  된다. Phase 7이 이 규칙에 실제로 기댔다 — 대량 삭제가 유발하는 cascade에 인덱스
  하나가 빠진 것을 뒤늦게 발견했을 때, 이미 배포된 마이그레이션을 고치지 않고 새
  마이그레이션으로 인덱스를 추가했다.
- **엔티티·마이그레이션·컨트롤러는 손으로 등록한다 — glob 탐색이 없다.**
  `src/app/models/index.ts`의 `ENTITIES`, `src/db/migrations/index.ts`의
  `MIGRATIONS`, `src/config/routes.module.ts`의 `controllers`는 전부 손으로
  채우는 배열이고, 셋 다 `src/config/database.ts`(앞 둘)와 `RoutesModule`(뒤
  하나)이 그대로 소비한다 — 이 배열에 없으면 그 엔티티·마이그레이션·라우트는
  존재하지 않는 것과 같다. 자동 탐색을 두지 않는 것은 참조 구현의 명시적
  계약이고, ESM + tsc 빌드에서 glob 경로는 `src/`와 `dist/`가 갈라지는 흔한
  실패원이기도 하다.
- **`src/app/serializers/index.ts`의 `SERIALIZERS`는 같은 모양이지만 성격이
  다르다 — 런타임이 소비하지 않는다.** 관계 대상은 각 시리얼라이저가 자기
  `relationships`에 적어 둔 `target()` 클로저가 정하고, `included`는
  `collectIncluded`가 소유 시리얼라이저의 `relationships`를 따라가며 조립한다 —
  둘 다 이 배열을 거치지 않는다. 이 배열을 읽는 것은 그 구성을 고정하는 테스트
  하나뿐이다(`test/serializers/example.serializer.spec.ts`). 그래서 등록을
  잊어도 관계 해석이나 `included` 조립 자체는 깨지지 않는다 — 다만 그 테스트가
  실패로 잡아 준다. 자세한 이유는 `src/app/serializers/AGENTS.md`를 따른다.
- **정렬을 여는 변경과 그로 인해 필요해진 인덱스를 만드는 변경은 같은 커밋에
  둔다.** `QueryPolicy`에 filter·sort를 추가하거나 `defaultSort`·`tieBreaker`를
  바꿀 때마다 해당 컬럼 조합의 인덱스 필요 여부를 판단하고, 필요하면 엔티티의
  인덱스 선언과 마이그레이션에 같은 변경으로 반영한다. 만들지 않기로 했으면 그
  근거를 정책 선언부 주석에 남긴다(`src/app/schemas/example.query-policy.ts`가 그
  예다). 이 규칙은 실제 사고에서 나왔다 — Phase 7에서 대량 삭제 배치가 유발하는
  `ON DELETE SET NULL` cascade UPDATE에 인덱스가 없어, 배치마다 전체 테이블을
  순차 스캔했다. `SET LOCAL lock_timeout`도 배치 상한(`MAX_BATCHES`)도 이 비용을
  막지 못했다 — 하나는 잠금 **대기**의 상한이고 하나는 왕복 **횟수**의 상한이지,
  둘 다 문장 **실행 시간**의 상한은 아니기 때문이다. 접근 경로를 뜨겁게 만드는
  변경이 인덱스를 진다.

엔티티와 마이그레이션의 제약·인덱스 이름은 글자까지 같아야 한다 — 하나라도 이름을
생략하면 TypeORM이 해시 이름을 만들어 어긋나고, `test/integration/migrations.spec.ts`의
스키마 드리프트 검사가 잡는다. Phase 6에서 이 검사가 실제로 두 번 잡았다: 단일
컬럼 `UNIQUE`를 인덱스 경로와 제약 경로로 다르게 선언한 경우, 그리고
마이그레이션에는 있지만 엔티티에 `@Index`가 없던 경우.

## 검증 명령

이 저장소의 검증 명령은 README의 `## 검증` 절과 문자 단위로 같다 —
`test/docs/agents.spec.ts`가 둘 다 같은 정본과 비교해 고정한다. 검사 범위와
순서, 개별 npm script 표는 README를 본다.

```bash
pnpm install --frozen-lockfile
./scripts/check.sh
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

## ESM과 TypeScript 버전 제약

스펙 18장 리스크 표가 이 저장소에 지운 의무가 둘 있다 — TypeScript 버전
고정을 근거와 함께 여기 남기는 것, ESM 상대 import 제약을 README와 함께
여기에도 명시하는 것. 이 문서가 생기기 전까지 둘 다 README에만 있었다.
규칙 자체와 예시(`TS2835` 오류 메시지 등)는 README의 "ESM 제약" 절이
정본이다 — 여기서는 왜, 그리고 어길 때 무슨 일이 나는지만 적는다. 코드를
쓰는 모든 디렉터리에 걸리는 제약이라 계층별 문서가 아니라 여기서 소유한다.

- **상대 import에 `.js`를 빠뜨리면 `tsc` 자신이 `TS2835`로 즉시 거부한다.**
  `"type": "module"` + `moduleResolution: node16` 조합의 결과다. `pnpm typecheck`가
  이미 이 규칙의 게이트이므로 ESLint 플러그인을 별도로 추가하지 않는다 —
  같은 것을 두 번 검사하게 만들 뿐이다.
- **TypeScript는 7.x로 올리지 않는다.** 7.x는 네이티브 컴파일러라 JS
  컴파일러 API를 노출하지 않고, `ts-jest`와 `typescript-eslint` 둘 다 그
  API에 기대므로 동작하지 않게 된다 — `package.json`의 `typescript`
  devDependency를 건드릴 때는 이 상한을 넘지 않는지 확인한다. 상향은 두
  도구가 TS 7 API를 지원한 뒤로 미룬다.

## 조립점과 변경 순서

새 자원을 더할 때는 아래 순서로 건드린다. 순서가 중요한 이유는 각 단계가 앞
단계의 산출물을 참조하기 때문이다 — 거꾸로 하면 아직 없는 것을 가리키게 된다.

1. **엔티티.** `src/app/models/`에 컬럼·관계·제약·인덱스를 선언하는 파일을
   만든다(`src/app/models/example.entity.ts` 참고). 정렬·필터에 쓸 컬럼 조합의
   인덱스는 이 시점에 함께 정한다(위 DB 규칙 참고). `src/app/models/index.ts`의
   `ENTITIES`에 등록한다 — 파일 추가와 이 등록은 같은 커밋이어야 DataSource가 그
   엔티티를 실제로 안다.
2. **마이그레이션.** 엔티티가 선언한 테이블·제약·인덱스를 SQL로 짓는다. 이름은
   엔티티 데코레이터가 명시한 이름과 글자까지 같게 쓴다. 파일명·클래스명 규약은
   `src/db/migrations/index.ts`의 주석을 따른다. `src/db/migrations/index.ts`의
   `MIGRATIONS`에 등록한다.
3. **쓰기 스키마와 조회 정책.** `src/app/schemas/`에 Create/Update DTO와 관계
   쓰기 스키마(`example.schemas.ts` 참고), filter·sort·include
   allowlist(`example.query-policy.ts` 참고)를 만들고 `src/app/schemas/index.ts`에서
   export한다. `PUT`(upsert)까지 지원할 자원이면 Replace DTO도 이때 함께
   만든다 — 5번의 `replaceSchema`가 이것을 가리킨다.
4. **시리얼라이저.** `src/app/serializers/`에 공개 표현과 `resourcePath`, 관계
   대상·`included`용 Erased 버전을 만든다(`example.serializer.ts` 참고).
   `resourcePath`는 5번의 컨트롤러 경로와 문자열까지 같아야 한다.
   `src/app/serializers/index.ts`에서 export하고, 다른 자원의 관계 대상이거나
   `included`에 실릴 것이면 `SERIALIZERS`에도 추가한다.
5. **컨트롤러.** `src/app/controllers/api/v1/`에 `CrudActions`로 위 산출물을
   선언만으로 잇는 파일을 만든다(`examples.controller.ts` 참고). `@Controller`
   경로가 시리얼라이저의 `resourcePath`와 다르면 조립 시점(부트스트랩)에 즉시
   던진다 — 잘못된 링크가 조용히 나가지 않는다. 이 선언이 쓰기 인증과 upsert
   지원 여부를 함께 정한다. `writeGuards`는 기본값이 빈 배열이고
   `route-registrar.ts`는 빈 배열을 "가드 없음"으로 그대로 적용하므로, 적지
   않으면 그 자원의 쓰기와 관계 변경은 공개로 열린다 — 스펙 16장의 "읽기는
   공개, 쓰기는 인증"을 따르려면 `ExamplesController`처럼
   `writeGuards: [JwtActiveUserGuard]`를 명시한다. `enableUpsert`를 켜면 3번에서
   만든 Replace DTO를 `replaceSchema`로 함께 넘겨야 한다 — 빠뜨리면
   `CrudActions`가 조립 시점에 던진다. 이 세 옵션이 정확히 어느 라우트에 닿고
   닿지 않는지는 `src/app/controllers/concerns/AGENTS.md`가 다룬다.
6. **라우트 등록.** `src/config/routes.module.ts`의 `controllers`에 추가한다.
   여기 없으면 앞의 다섯 단계를 다 밟아도 라우트는 존재하지 않는다.

이 여섯 단계를 다 밟아도 README는 자동으로 갱신되지 않는다 — 문서 동기화 테스트
(`test/docs/readme.spec.ts`)는 `## 구조` 절의 경로 존재, `## 검증` 절의 명령
문자열과 순서, `pnpm migrate`/`pnpm seed` 명령과 ESM `.js` 제약이 언급되는지,
그리고 정해 둔 필수 환경 변수 이름만 본다. 새 자원의 공개 라우트를
README의 `## 공개 API 표면` 표에 손으로 추가하는 것은 이 테스트로 잡히지 않는다.
같은 종류의 README 드리프트가 실제로 있었다 — Phase 4는 README 갱신 자체를
빠뜨렸고, Phase 7은 README의 환경 변수 표에서 `TEST_REDIS_URL` 한 줄을
빠뜨렸다. 넷으로 얼어붙어 있던 것은 README가 아니라 그것을 잡아야 할 시험
(`test/docs/readme.spec.ts`의 "필수 환경 변수를 모두 문서화한다")이었다 —
Phase 2 때 고정한 네 개짜리 검사 목록이 그대로 남은 사이 `JWT_SECRET_KEY`·
`REDIS_URL`·`TEST_REDIS_URL` 세 개가 늘어 실제 필수 목록이 일곱이 됐는데도
검사는 넷만 보고 있었다. 둘 다 게이트가 아니라 다음 리뷰에서 사람이 잡았다.
