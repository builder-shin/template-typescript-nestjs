<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/schemas

## 목적

쓰기 attributes의 DTO, 관계 linkage 허용 목록과 조회 정책을 선언합니다.
입력값을 검증하며 ORM 저장·SQL 조립·공개 응답 조립은 각 소유 계층에 맡깁니다.

## 주요 파일

| 파일                       | 설명                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `write-schema.ts`          | DTO 변환·검증, 관계 쓰기 타입과 검증 메타데이터 기반 필드 목록.    |
| `query-policy.ts`          | filter·sort·include 정책 타입, 연산자 집합과 최대 페이지 크기 100. |
| `example.schemas.ts`       | 생성·부분 수정·전체 교체 DTO와 category·tags 쓰기 선언.            |
| `example.query-policy.ts`  | Example의 공개 조회 항목, 기본 정렬과 인덱스 판단.                 |
| `category.query-policy.ts` | 분류 이름 필터·정렬과 빈 include 허용 목록.                        |
| `tag.query-policy.ts`      | 라벨 이름 필터·정렬과 빈 include 허용 목록.                        |
| `auth.schemas.ts`          | 이메일 소문자 변환, 가입·로그인·refresh 입력 검증.                 |
| `index.ts`                 | DTO·정책·관계 타입·검증 함수의 공개 export.                        |

## AI 에이전트 지침

- `plainToInstance` 뒤 `whitelist`·`forbidNonWhitelisted`로 검증합니다. 미선언 필드를
  조용히 버리지 않으며 오류 문구는 class-validator 문자열 대신 카탈로그에서 고릅니다.
- nullable 필드에는 `IsOptional`, NOT NULL 선택 필드에는 `ValidateIf(isPresent)`를
  사용합니다. 생성·교체의 `title`·`status`·`score`는 필수입니다.
- PATCH에서 보냈는지는 원본 `presentKeys`로 판정합니다. PUT의 소유 필드 목록은
  `schemaProperties`의 검증 메타데이터를 사용하며 DTO 인스턴스의 키로 대체하지 않습니다.
- 내부 FK는 DTO에 추가하지 않습니다. 관계의 이름·type·cardinality는 엔티티 및
  시리얼라이저와 맞춥니다.
- SQL 컬럼명은 정책의 `property`에서만 나옵니다. 새 filter·sort와 기본 정렬 변경은
  인덱스 판단을 함께 기록합니다. `id`는 Example의 공개 정렬이 아닌 tie breaker입니다.
- `score` 조회 정책은 현재 `number`라 소수 필터도 허용하는 알려진 참조 구현 차이가
  있습니다. 쓰기 DTO의 정수 검증과 같은 계약이라고 가정하지 않습니다.
- 이메일 정규화는 `auth.schemas.ts` 한 곳에서 합니다. 로그인 비밀번호 길이 정책은
  가입 정책과 다르므로 두 DTO를 합치기 전에 해당 의도를 확인합니다.

## 테스트

저장소 루트에서 `pnpm typecheck`와
`pnpm test:quick --runInBand test/schemas test/jsonapi`를 실행합니다. 조회 정책의 실제
SQL 변경은 PostgreSQL과 `TEST_DATABASE_URL`을 준비하고
`pnpm test:quick --runInBand test/integration/query-compiler.spec.ts test/integration/reference-resources.spec.ts`로
검증합니다. 쓰기 계약 변경은 해당 자원의 HTTP 통합 검사도 실행합니다.

## 의존성

class-transformer, class-validator, TypeORM 타입과 `../models/`의 자원 선언,
`../jsonapi/`의 오류 카탈로그를 사용합니다. 검증 결과는 컨트롤러 concern이 소비합니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
