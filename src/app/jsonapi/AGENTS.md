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
