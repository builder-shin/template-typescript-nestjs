# 저장소 전체 계약

이 문서는 이 저장소에서 코드를 바꾸는 모든 사람과 에이전트가 따라야 할 저장소 전체
계약을 담는다 — 아키텍처, 데이터베이스 규칙, 검증 명령, 그리고 새 자원을 더할 때
건드릴 파일과 그 순서. 실행 방법·환경 변수·API 사용법·Docker 실행은 `README.md`가
소유한다. 계층별 세부 규칙(모델·시리얼라이저·컨트롤러 concern 등)은 스펙 14장이
정한 대로 각 디렉터리 자신의 `AGENTS.md`가 따로 소유한다.

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
- **엔티티·마이그레이션·컨트롤러·시리얼라이저는 손으로 등록한다 — glob 탐색이
  없다.** `src/app/models/index.ts`의 `ENTITIES`, `src/db/migrations/index.ts`의
  `MIGRATIONS`, `src/config/routes.module.ts`의 `controllers`,
  `src/app/serializers/index.ts`의 `SERIALIZERS`는 전부 손으로 채우는 배열이다 —
  이 배열에 없으면 그 엔티티·마이그레이션·라우트·시리얼라이저는 존재하지 않는
  것과 같다. 자동 탐색을 두지 않는 것은 참조 구현의 명시적 계약이고, ESM + tsc
  빌드에서 glob 경로는 `src/`와 `dist/`가 갈라지는 흔한 실패원이기도 하다.
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
3. **쓰기 스키마와 조회 정책.** `src/app/schemas/`에 Create/Update/Replace
   DTO와 관계 쓰기 스키마(`example.schemas.ts` 참고), filter·sort·include
   allowlist(`example.query-policy.ts` 참고)를 만들고 `src/app/schemas/index.ts`에서
   export한다.
4. **시리얼라이저.** `src/app/serializers/`에 공개 표현과 `resourcePath`, 관계
   대상·`included`용 Erased 버전을 만든다(`example.serializer.ts` 참고).
   `resourcePath`는 5번의 컨트롤러 경로와 문자열까지 같아야 한다.
   `src/app/serializers/index.ts`에서 export하고, 다른 자원의 관계 대상이거나
   `included`에 실릴 것이면 `SERIALIZERS`에도 추가한다.
5. **컨트롤러.** `src/app/controllers/api/v1/`에 `CrudActions`로 위 산출물을
   선언만으로 잇는 파일을 만든다(`examples.controller.ts` 참고). `@Controller`
   경로가 시리얼라이저의 `resourcePath`와 다르면 조립 시점(부트스트랩)에 즉시
   던진다 — 잘못된 링크가 조용히 나가지 않는다.
6. **라우트 등록.** `src/config/routes.module.ts`의 `controllers`에 추가한다.
   여기 없으면 앞의 다섯 단계를 다 밟아도 라우트는 존재하지 않는다.

이 여섯 단계를 다 밟아도 README는 자동으로 갱신되지 않는다 — 문서 동기화 테스트
(`test/docs/readme.spec.ts`)는 `## 구조` 절의 경로 존재, `## 검증` 절의 명령
문자열, 그리고 정해 둔 필수 환경 변수 이름만 본다. 새 자원의 공개 라우트를
README의 `## 공개 API 표면` 표에 손으로 추가하는 것은 이 테스트로 잡히지 않는다.
같은 종류의 README 드리프트가 실제로 있었다 — Phase 4는 README 갱신 자체를
빠뜨렸고, Phase 7은 README의 필수 환경 변수 목록이 넷으로 얼어붙은 채 다섯 번째가
늘어난 것을 몰랐다. 둘 다 게이트가 아니라 다음 리뷰에서 사람이 잡았다.
