<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/jsonapi

## 목적

JSON:API 1.1의 문서 구조, 협상·오류·응답, 조회 파서와 페이지네이션을 DB 없이 검사한다.
실제 SQL 실행과 HTTP를 통한 전체 계약은 [통합 검사](../integration/AGENTS.md)에 둔다.

## 주요 파일

| 파일                                                 | 설명                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [media-type.spec.ts](media-type.spec.ts)             | vendor 상수, 파라미터 제거와 전송 시 charset 재부착 방지를 검사한다.                                   |
| [negotiation.spec.ts](negotiation.spec.ts)           | Accept·Content-Type, 본문이 있는 DELETE·chunked 요청, 협상 제외 메타데이터와 오류 우선순위를 검사한다. |
| [language.spec.ts](language.spec.ts)                 | ko/en 선택, 지역 태그·q 값·명시도·순서·와일드카드와 기본 언어를 검사한다.                              |
| [errors.spec.ts](errors.spec.ts)                     | 오류 코드 24개의 status·ko/en 문구와 단일·집합 오류 객체를 고정한다.                                   |
| [exception-filter.spec.ts](exception-filter.spec.ts) | 오류 문서와 Nest 예외 변환, 내부 메시지 은닉·서버 로그·언어·vendor 헤더를 검사한다.                    |
| [response.spec.ts](response.spec.ts)                 | 응답 인터셉터의 vendor 헤더, 전송 시 charset 방지, 제외 라우트와 204 본문 전달을 검사한다.             |
| [document.spec.ts](document.spec.ts)                 | 자원·관계 linkage 입력 구조, type/id 오류, presentKeys와 source.pointer를 검사한다.                    |
| [filter.spec.ts](filter.spec.ts)                     | 정책별 연산자·프로퍼티 매핑, 값 변환, 날짜·마이크로초 정밀도와 잘못된 입력·정책을 검사한다.            |
| [sort.spec.ts](sort.spec.ts)                         | 공개 필드와 저장 프로퍼티 매핑, 기본·명시 정렬, tie breaker와 정렬 서명을 검사한다.                    |
| [include.spec.ts](include.spec.ts)                   | 정책과 시리얼라이저 선언의 교집합, 중복 제거와 허용되지 않은 경로를 검사한다.                          |
| [pagination.spec.ts](pagination.spec.ts)             | offset/cursor 선택·거부, 한 행 추가 조회, self·prev·next·first·last 링크를 검사한다.                   |
| [cursor.spec.ts](cursor.spec.ts)                     | 커서 인코딩·디코딩과 정렬 일치, nullable 거부, before/after의 keyset 조건을 검사한다.                  |
| [query.spec.ts](query.spec.ts)                       | 목록·단건·관련 컬렉션별 허용 파라미터와 하위 파서 오류를 조립해 검사한다.                              |

## AI 에이전트 지침

- source.pointer와 source.parameter, JSON:API 오류 code까지 검사한다. 같은 HTTP
  상태를 공유하는 다른 실패가 원래 검증 대상을 대신하지 않도록 입력을 구성한다.
- 조회 입력은 simple 질의 파서가 만드는 대괄호 키의 평평한 객체다. 필드의 공개 이름과
  저장 프로퍼티가 다른 fixture를 유지해 매핑이 생략되는 회귀를 잡는다.
- 커서 파서의 조건 문자열 검사와 실제 DB 페이지 이동은 별개다.
  [query-compiler.spec.ts](../integration/query-compiler.spec.ts)도 함께 검토한다.
- 응답 헤더는 전송 단계에서 charset이 덧붙는 경로까지 확인한다. 실제 HTTP의 최종
  헤더는 [health.controller.spec.ts](../health.controller.spec.ts) 등에서 확인한다.
- Reflector용 handler·controller 객체는 호출 사이에 같은 참조를 유지한다.
  Nest Logger를 교체했다면 복원하고, 언어 변경은 ko/en을 함께 확인한다.
- 신규 프로토콜 허용 항목은 정상·거부·경계 사례를 함께 둔다.
  공통 ESM·회귀 작성 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

## 검증

저장소 루트에서 실행한다. 외부 DB·Redis나 실행 중인 별도 앱은 필요 없다.

```bash
pnpm test:jsonapi --runInBand
pnpm typecheck
```

## 의존성

src/app/jsonapi의 프로토콜 모듈과 src/app/schemas/query-policy.ts에 의존한다.
Jest, Nest 타입·Reflector·Logger, RxJS를 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
