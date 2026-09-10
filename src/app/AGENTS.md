<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app 안내

## 목적

JSON:API 요청 처리, 선언형 자원 CRUD, 영속성 선언, 인증과 백그라운드 작업을 둡니다.
실행 환경과 Nest 모듈 조립은 `../config/`가 소유합니다. 아래 수동 계약은 필드의
nullable 처리와 관계 표현을 바꿀 때 함께 읽습니다.

## 하위 디렉터리

| 디렉터리       | 역할                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `auth/`        | 비밀번호, JWT, 활성 사용자 확인과 refresh session 수명. [auth/AGENTS.md](auth/AGENTS.md) 참고.      |
| `controllers/` | 상태 확인, 자원별 HTTP 선언과 공통 concern. [controllers/AGENTS.md](controllers/AGENTS.md) 참고.    |
| `jobs/`        | BullMQ 생산자, 독립 워커와 작업 처리. [jobs/AGENTS.md](jobs/AGENTS.md) 참고.                        |
| `jsonapi/`     | 문서·쿼리 파싱, 협상, 오류 응답과 SQL 컴파일. [jsonapi/AGENTS.md](jsonapi/AGENTS.md) 참고.          |
| `models/`      | TypeORM 엔티티와 명시적 등록 목록. [models/AGENTS.md](models/AGENTS.md) 참고.                       |
| `schemas/`     | 쓰기 DTO, 관계 linkage와 조회 허용 목록. [schemas/AGENTS.md](schemas/AGENTS.md) 참고.               |
| `serializers/` | 공개 attributes·relationships와 included 조립. [serializers/AGENTS.md](serializers/AGENTS.md) 참고. |

## AI 에이전트 지침

- 자원은 엔티티 → 마이그레이션 → 스키마 → 시리얼라이저 → 컨트롤러 → 라우트 등록
  순서로 조립합니다. 자원별 service를 만들지 않습니다.
- 상대 TypeScript import에는 `.js`를 붙입니다. 계층의 소유권과 명시적 등록 규칙은
  루트 계약을 따릅니다.
- 코드 변경에는 `pnpm typecheck`와 자식 가이드의 대상 테스트를 실행합니다. 실제
  트랜잭션·쿼리·인증 상태는 PostgreSQL 통합 테스트로, 큐는 Redis 통합 테스트로
  검증합니다. 준비 방법과 fixture 계약은 [test/AGENTS.md](../../test/AGENTS.md)를 봅니다.
- 안내 문서만 바꾸면 `pnpm test:quick --runInBand test/docs`와 저장소 형식·링크·secretlint
  검사를 실행합니다.

<!-- MANUAL: 기존 main의 계층 계약을 보존합니다. 이 줄 아래는 자동 재생성하지 않습니다. -->

# src/app/ — 모델·스키마·시리얼라이저·컨트롤러

계층별로 무엇을 소유하고 무엇을 소유하지 않는지의 표는 루트 `AGENTS.md`의
"아키텍처" 절에 있다. 이 문서는 그 표를 반복하지 않고, 표만으로는 보이지 않는
두 규칙 — 필드 하나의 표기가 요청의 성패를 가르는 규칙과, 같은 컬럼을 입출력
양쪽에서 두 갈래로 열지 않는 규칙 — 을 적는다.

## 선택 필드 표기는 컬럼의 nullable 여부를 따라간다

`class-validator`의 `@IsOptional()`은 `undefined`뿐 아니라 **`null`에도**
뒤따르는 모든 검증기를 건너뛴다. NOT NULL 컬럼에 이 데코레이터를 달면
`{"title": null}`이 검증을 그대로 통과해 PostgreSQL까지 내려가고, 사용자 입력
오류로 응답해야 할 422가 제약 위반 500으로 나간다 — 이 저장소가 실제로 이
버그를 만들었다가 고쳤다.

`src/app/schemas/example.schemas.ts`가 지금 쓰는 대응 관계가 정본이다.

- 컬럼이 nullable이면(`description`) `@IsOptional()`을 쓴다 — `null`이
  "비운다"는 유효한 의미를 갖는다.
- 컬럼이 NOT NULL이면(`title`, `status`, `score`) `@ValidateIf`로 "아예 보내지 않았다"만
  건너뛰고, 명시적으로 보낸 `null`은 검증기에 그대로 넘겨 422로 거절한다.

새 쓰기 스키마를 만들 때는 필드마다 "엔티티(`src/app/models/`)에서 이 컬럼이
nullable인가"부터 확인하고 표기를 고른다 — 취향이 아니라 컬럼 정의에서
기계적으로 정해지는 값이다.

## 내부 FK는 공개 입력도 공개 출력도 아니다

`categoryId`처럼 관계를 구현하는 FK 컬럼은 어떤 쓰기 스키마(`src/app/schemas/`)의
필드도, 어떤 시리얼라이저(`src/app/serializers/`)의 attribute도 아니다. 관계는
오직 JSON:API의 `relationships`로만 읽고 쓴다. 이유는 입출력 양쪽에서 같다 —
FK를 필드로 열면 같은 관계를 바꾸는 길이 두 개가 되고(attribute 직접 쓰기 vs.
relationships linkage), 두 경로의 검증 규칙과 오류 코드가 갈라진다.
`src/app/schemas/example.schemas.ts`와 `src/app/serializers/example.serializer.ts`가
이 규칙을 입력과 출력 양쪽에서 각자 독립적으로 적는다 — 관계를 새로 추가할
때는 두 파일 모두에서 FK 컬럼이 아니라 관계 이름으로만 다뤄지는지 확인한다.

## 함께 고쳐야 하는 파일

새 자원을 추가할 때 어떤 파일을 어떤 순서로 만드는지는 루트 `AGENTS.md`의
"조립점과 변경 순서"가 여섯 단계로 정한다. 여기서는 그 순서 밖에서, 같은
계층을 손볼 때 놓치기 쉬운 짝만 적는다.

- **엔티티 컬럼의 nullable을 바꿀 때.** `src/app/models/`의 컬럼 정의와, 그
  컬럼을 다루는 모든 쓰기 스키마의 `@IsOptional()`/`@ValidateIf` 선택을 같은
  커밋에서 맞춘다. 하나만 바꾸면 위 규칙이 깨지는데, 그 실패는 "유효한
  요청"도 "명백히 무효한 요청"도 아닌 값(명시적 `null`)에서만 드러나 테스트가
  우연히 놓치기 쉽다.
- **관계를 추가하거나 cardinality를 바꿀 때.** 엔티티의 관계 데코레이터
  (`src/app/models/`), 쓰기 스키마의 `RelationshipWriteSchema` 항목
  (`src/app/schemas/write-schema.ts`), 시리얼라이저의 `relationships` 선언
  (`src/app/serializers/`) 세 곳이 같은 cardinality와 같은 대상 타입을
  가리켜야 한다. 스키마와 시리얼라이저 사이의 cardinality 불일치는
  `src/app/controllers/concerns/crud-actions.ts`의 `CrudActions`가 조립
  시점에 `TypeError`로 잡아 주지만, 그 검사는 어긋났다는 사실만 알려줄 뿐 세
  곳 중 무엇이 맞는 값인지는 알려주지 않는다.
- **쓰기 스키마의 길이·형식 제약을 바꿀 때.** 스키마 쪽 제약은 엔티티 컬럼의
  실제 제약(`varchar(200)` 등)보다 항상 같거나 더 엄격해야 한다 — 스키마가
  더 느슨하면 DB가 거절해 400이어야 할 요청이 500으로 나간다.
