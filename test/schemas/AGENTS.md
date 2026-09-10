<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/schemas

## 목적

HTTP 쓰기 DTO와 QueryPolicy의 공개 허용 목록, 검증 오류의 JSON:API 표현을 검사한다.
DB 조회를 수행하지 않고 입력 정책·엔티티·시리얼라이저 선언 사이의 일치를 확인한다.

## 주요 파일

| 파일                                                         | 설명                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [write-schema.spec.ts](write-schema.spec.ts)                 | DTO 변환·미선언 필드 거부·중첩 오류 pointer, 데코레이터와 상속 필드 추출을 검사한다.            |
| [query-policy.spec.ts](query-policy.spec.ts)                 | 필터 연산자 여덟 개와 판정 함수, 최대 페이지 크기 100을 고정한다.                               |
| [example.schemas.spec.ts](example.schemas.spec.ts)           | Create/Update/Replace의 필수·nullable·범위 검증과 관계 type·cardinality 일치를 검사한다.        |
| [example.query-policy.spec.ts](example.query-policy.spec.ts) | Example의 filter·sort·include 허용 목록, FK 매핑, 기본 정렬·tie breaker·페이지 크기를 검사한다. |
| [auth.schemas.spec.ts](auth.schemas.spec.ts)                 | 가입·로그인 이메일 정규화와 서로 다른 비밀번호 제한, refresh 토큰 입력을 검사한다.              |

## AI 에이전트 지침

- Create와 Replace는 title·status·score를 요구하고 Update는 생략을 허용한다.
  NOT NULL 속성의 명시적 null과 nullable description의 null을 따로 검사한다.
- 클래스의 검증 데코레이터가 공개 입력을 정한다. validateAttributes로 실제 변환과
  검증을 거쳐 JsonApiErrors·source.pointer를 확인하며, 라이브러리의 영문 문구나
  입력값을 공개 오류에 싣지 않는 경계도 유지한다.
- 중첩 합성과 extends 상속은 서로 다른 검사다. schemaProperties 변경에서는
  자식의 내부 속성을 섞지 않으면서 상속한 공개 필드를 빠뜨리지 않는지 확인한다.
- 조회 정책을 바꾸면 enum·FK 프로퍼티·시리얼라이저 관계 선언과 함께 대조한다.
  공개 sort에 없는 id tie breaker를 허용 목록에 자동으로 노출하지 않는다.
- 새 filter·sort는 실제 SQL 동작과 인덱스 판단도 필요하다. 그 증명은
  [query-compiler.spec.ts](../integration/query-compiler.spec.ts)와
  [migrations.spec.ts](../integration/migrations.spec.ts)에서 수행한다.

## 검증

저장소 루트에서 실행한다. 이 디렉터리의 검사는 외부 서비스가 필요 없다.

```bash
pnpm test:quick --runInBand test/schemas
pnpm typecheck
```

## 의존성

src/app/schemas, 모델의 상태 enum, 시리얼라이저 관계 선언과 JSON:API 오류에 의존한다.
Jest, class-transformer, class-validator를 사용하며 공통 규칙은
[상위 가이드](../AGENTS.md)를 따른다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
