<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/serializers

## 목적

엔티티와 비영속 객체의 JSON:API 공개 표현, 링크·관계 linkage·included를 검사한다.
DB나 HTTP 서버를 띄우지 않고 시리얼라이저 함수와 선언을 직접 실행한다.

## 주요 파일

| 파일                                                     | 설명                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [serializer.spec.ts](serializer.spec.ts)                 | 공통 attributes·링크·관계의 생략/null/배열, included 대상 직렬화·중복 제거·미선언 경로 오류를 검사한다. |
| [example.serializer.spec.ts](example.serializer.spec.ts) | Example·Category·Tag의 공개 type·필드·경로·관계와 SERIALIZERS 등록 배열을 검사한다.                     |
| [auth.serializers.spec.ts](auth.serializers.spec.ts)     | 사용자 비밀번호 해시 비노출, self 링크 생략, authTokens의 다섯 속성과 초 단위 수명을 검사한다.          |

## AI 에이전트 지침

- 자원별 fixture는 실제 엔티티 인스턴스로 만든다. 관계 대상의 serializeUnknown은
  instanceof로 좁히므로 모양만 같은 객체로 바꾸면 실제 진입 계약이 달라진다.
- undefined 관계는 미로드, null은 없는 to-one, 빈 배열은 빈 to-many다.
  linkage와 included가 이 차이를 보존하는지 확인한다.
- resourcePath가 없는 사용자·발급 응답에 존재하지 않는 self URL을 만들지 않는다.
  경로가 있는 자원은 컨트롤러 경로와 맞고, 관계 링크는 소유 자원 경로를 따른다.
- SERIALIZERS의 등록 검사는 런타임 관계 탐색과 다르다. 실제 대상은 관계 선언의
  target()이 정하며, 배열 검사만 통과했다고 included 동작을 검증한 것으로 보지 않는다.
- 참조 자원의 공개 attributes는 name 하나이고 내부 FK·비밀번호 해시는 공개하지
  않는다. 엔티티에 필드가 있다는 이유만으로 응답 기대값을 넓히지 않는다.
- 토큰 수명 fixture는 서로 다르고 운영 기본값과도 다른 값을 쓴다. 필드 뒤바뀜과
  잘못된 기본값 사용이 우연히 통과하지 않도록 한다.

## 검증

저장소 루트에서 실행한다. 외부 서비스는 필요 없다.

```bash
pnpm test:quick --runInBand test/serializers
pnpm typecheck
```

## 의존성

src/app/serializers, 모델 클래스와 관계 쓰기 스키마 선언에 의존한다.
Jest와 엔티티 메타데이터를 사용한다. 공통 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
