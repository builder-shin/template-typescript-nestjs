<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/jsonapi 안내

## 목적

자원에 독립적인 JSON:API 협상, 요청 문서·조회 파싱, 페이지 링크, SQL 컴파일과
오류 응답을 제공합니다. 특정 자원의 허용 필드는 `../schemas/`의 정책이 정합니다.

## 주요 파일

| 파일                  | 설명                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `media-type.ts`       | vendor 미디어 타입 상수와 Express 응답 파라미터 제거.               |
| `negotiation.ts`      | Accept·Content-Type 가드와 협상 제외 메타데이터.                    |
| `response.ts`         | 협상 제외 선언을 따르는 성공 응답 Content-Type 인터셉터.            |
| `errors.ts`           | 24개 오류 코드의 상태와 한국어·영어 title·detail 카탈로그.          |
| `exception-filter.ts` | 모든 예외를 JSON:API 오류 문서로 정규화하고 예상 밖 오류를 기록.    |
| `language.ts`         | Accept-Language의 품질값·명시도·등장 순서로 ko/en 선택.             |
| `document.ts`         | 자원 문서·linkage 구조 검사와 원본 attributes의 `presentKeys` 보존. |
| `query.ts`            | 목록·단건·관계 URL별 허용 쿼리 검증과 파서 조립.                    |
| `filter.ts`           | 정책 기반 연산자·값 검증과 timestamp 소수 초 처리.                  |
| `sort.ts`             | 허용 정렬 해석, tie breaker 보강과 커서용 정렬 서명.                |
| `include.ts`          | 조회 정책과 시리얼라이저 양쪽에 선언된 include 경로 검증.           |
| `pagination.ts`       | offset·cursor 입력, probe와 페이지 링크 조립.                       |
| `cursor.ts`           | base64url 커서, 정렬 서명 검증과 혼합 방향 keyset 비교식.           |
| `query-compiler.ts`   | 검증된 filter·sort·include·page를 TypeORM 질의로 실행.              |

## AI 에이전트 지침

- 아래 수동 계약의 협상·오류 경계를 유지합니다. 오류의 title과 detail은 함께
  카탈로그에서 협상하며 호출자가 자유 문자열이나 입력값을 응답 문구로 붙이지 않습니다.
- 문서 구조는 400, 쓰기 값 검증은 `../schemas/`의 422로 나눕니다. `presentKeys`는
  DTO 변환 전에 확보한 원본 키 집합입니다.
- 조회 문자열은 Express의 평평한 쿼리 맵으로 받습니다. SQL 컬럼은 정책의 `property`,
  비교값은 바인딩 파라미터를 사용합니다. `contains`의 와일드카드 이스케이프를 유지합니다.
- timestamp 필터는 실제 달력 날짜를 검사하고 소수 초 7자리 이상을 6자리로 자릅니다.
  마이크로초를 유지하려고 검증 후에도 `Date` 대신 문자열로 DB에 전달합니다.
- 목록 COUNT는 `page[totals]=true`에만 실행합니다. 관계 컬렉션은 항상 총 개수를
  반환하고 서버가 만든 링크의 `page[totals]`도 받을 수 있어야 합니다.
- nullable 정렬은 커서 모드에서 거부합니다. `page[before]`의 역방향 읽기와 결과 순서
  복원을 함께 검토합니다.
- 미디어 타입 협상의 `q` 값은 현재 순위를 계산하지 않습니다. `language.ts`의 실제
  품질값 해석과 같은 동작이라고 가정하지 않습니다.

## 테스트

저장소 루트에서 `pnpm typecheck`와 `pnpm test:jsonapi --runInBand`를 실행합니다.
실제 질의 동작은 PostgreSQL과 `TEST_DATABASE_URL`을 준비하고
`pnpm test:quick --runInBand test/integration/query-compiler.spec.ts`로 확인합니다.
전역 HTTP 처리 변경에는 health·config HTTP 검사도 필요하며 이들 역시 PostgreSQL을
사용합니다. fixture 규칙은 [test/AGENTS.md](../../../test/AGENTS.md)를 따릅니다.

## 의존성

`../schemas/`의 QueryPolicy, `../serializers/`의 관계 선언, NestJS 가드·필터·인터셉터,
TypeORM과 RxJS를 사용합니다. HTTP parser와 전역 등록은 `../../config/`가 소유합니다.

<!-- MANUAL: 기존 main의 프로토콜 계약을 보존합니다. 이 줄 아래는 자동 재생성하지 않습니다. -->

# src/app/jsonapi/ — JSON:API 1.1 프로토콜 계층

이 디렉터리는 JSON:API 1.1 프로토콜 자체를 소유한다 — 미디어 타입 협상, 오류
문서, 질의 파라미터 해석(filter·sort·include·page), 응답 조립. 특정 자원을
모른다 — `Example`이나 `Category` 같은 이름은 이 디렉터리 어디에도 나오지
않는다.

## vendor 미디어 타입에는 파라미터가 없다

`JSONAPI_MEDIA_TYPE`(`application/vnd.api+json`)은 파라미터 없이 정확히 이
문자열이어야 한다. JSON:API 1.1이 vendor 타입에 허용하는 예외는 `ext`와
`profile`뿐인데 이 템플릿은 둘 다 구현하지 않으므로, `q`(HTTP 협상 파라미터)를
제외한 어떤 파라미터도 받아들이지 않는다 — `src/app/jsonapi/negotiation.ts`의
판정이 그렇다.

응답 쪽에서도 같은 제약을 지켜야 하는데, Express의 `res.send()`는 문자열
본문에 `charset=utf-8`을 무조건 덧붙인다. 그대로 두면 서버가 자기 응답에 실은
`Content-Type`이 자기 협상 가드가 거부하는 바로 그 문자열이 된다 —
`src/app/jsonapi/media-type.ts`의 `pinJsonApiContentType`이 `setHeader`를
감싸 이 덧붙임을 무력화한다. 이 계층에서 응답 헤더를 새로 세팅하는 코드를
추가한다면 이 함수를 거치는지부터 확인한다.

## 오류는 24개 고정 카탈로그에서 고른다

`src/app/jsonapi/errors.ts`의 `ERROR_CATALOG`가 코드 → (ko 메시지, en 메시지,
HTTP status)의 유일한 소유자다. 오류를 던지는 자리는 이 카탈로그의 코드 하나를
골라 `JsonApiError`를 만들 뿐, 메시지나 status를 직접 정하지 않는다 — 그래서
같은 오류 상황은 어디서 던지든 같은 응답 모양이 된다.

## `JsonApiError`는 사용자 입력, `TypeError`는 프로그래밍 오류

이 계층(그리고 이 계층을 따르는 `src/app/controllers/concerns/`나
`src/app/serializers/`)은 실패를 두 종류로 명확히 가른다.

- **`JsonApiError`/`JsonApiErrors`** — 사용자가 보낸 값이 잘못됐을 때. 예외
  필터(`src/app/jsonapi/exception-filter.ts`)가 이것을 카탈로그 기반 오류
  문서로 그대로 직렬화하고, 로그를 남기지 않는다 — 카탈로그에 있는 의도된
  결과이기 때문이다.
- **`TypeError`** — 이미 검증됐어야 할 불변식이 깨졌을 때. 예를 들어
  `src/app/jsonapi/query-compiler.ts`는 `include` 파서가 이미 정책과
  시리얼라이저 양쪽에 대조해 통과시킨 경로만 받는다고 가정하는데, 그럼에도
  선언되지 않은 관계 경로가 들어오면 `TypeError`로 죽는다 — 사용자가 그
  상태를 직접 만들 방법이 없어야 하고, 있다면 그것은 이 `TypeError`가 아니라
  상류의 검증 누락이 결함이다. 예외 필터는 이런 알 수 없는 오류를
  `INTERNAL_SERVER_ERROR`(500)로 뭉개 응답하되, 서버 로그에는 스택과 함께
  남긴다 — 클라이언트는 코드만 보고 운영자는 원인을 본다.

새 검사를 추가할 때 이 둘 중 어느 쪽인지 먼저 정한다 — "사용자가 이 요청을
어떻게 구성해도 도달할 수 없는 상태"만 `TypeError`를 쓴다.

## 협상 가드는 메서드가 아니라 본문 유무로 판정한다

`JsonApiNegotiationGuard`(`src/app/jsonapi/negotiation.ts`)가 `Content-Type`
검증 여부를 정하는 기준은 HTTP 메서드가 아니라 **요청이 본문을 싣고
있는가**(`Transfer-Encoding`이 있거나 `Content-Length`가 `0`이 아님)다.
`POST`·`PUT`·`PATCH`는 프로토콜상 본문이 필수라 보강 조건으로 따로 잡지만,
그것은 "본문 없이 온 요청을 잡기 위한 보강"이지 판정 기준 자체가 아니다 —
`DELETE /api/v1/examples/{id}`는 본문이 없어 검사 대상이 아니고,
`DELETE /api/v1/examples/{id}/relationships/tags`는 linkage 본문을 실어
보내므로 검사 대상이다. 이 가드를 고칠 때 메서드로 분기하는 코드를 추가하고 싶어지면,
그것이 본문 유무 판정으로 이미 표현되는 것은 아닌지 먼저 의심한다.

## 함께 고쳐야 하는 파일

- **오류 코드를 추가하거나 지울 때.** `src/app/jsonapi/errors.ts`의
  `ERROR_CATALOG`·`JsonApiErrorCode`뿐 아니라 `test/jsonapi/errors.spec.ts`의
  두 단언(코드 개수, 코드 집합 전체)이 문자 그대로 코드 목록을 고정하고
  있어 실패한다. 스펙 문서
  (`docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md`
  5.2절)도 24개 코드를 나열하므로 같은 커밋에서 갱신한다.
- **미디어 타입 상수(`JSONAPI_MEDIA_TYPE`)를 바꿀 때.** `src/config/http.ts`의
  body parser 등록이 이 값을 그대로 참조한다 — 이 계층 밖에서 유일하게 이
  상수에 의존하는 조립 지점이다.
- **협상 판정 로직을 바꿀 때.** `src/app/jsonapi/media-type.ts`의
  `stripVendorMediaTypeParameters`와 `src/app/jsonapi/negotiation.ts`의
  파라미터 판정은 "vendor 타입에 `q` 외의 파라미터를 허용하지 않는다"는 같은
  규칙을 응답 쪽과 요청 쪽에서 각각 구현한다 — 확장(`ext`)이나 프로파일
  (`profile`)을 지원하게 되면 이 규칙 자체가 바뀌므로 두 파일을 함께 고친다.
