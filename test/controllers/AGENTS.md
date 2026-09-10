<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/controllers

## 목적

선언형 CRUD의 조립 오류, 문서 파싱과 응답 조립, 라우트·쓰기 가드 등록을 검사한다.
DB에 저장된 결과와 트랜잭션은 [통합 검사](../integration/AGENTS.md)에서 검증한다.

## 주요 파일

| 파일                                                     | 설명                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [crud-actions.spec.ts](crud-actions.spec.ts)             | 관계 선언·cardinality·쓰기 스키마·upsert 교체 스키마의 조립 시점 검사를 고정한다.          |
| [document-parsing.spec.ts](document-parsing.spec.ts)     | DTO 검증, 실제 전송 키인 presentKeys, 관계·id 전달과 보낸 속성만 적용하는 동작을 검사한다. |
| [documents.spec.ts](documents.spec.ts)                   | 단건·컬렉션의 data·included·links·meta.totalCount 생략 및 0건 표현을 검사한다.             |
| [jsonapi-controller.spec.ts](jsonapi-controller.spec.ts) | Controller 경로 정규화와 시리얼라이저 resourcePath 일치를 검사한다.                        |
| [route-registrar.spec.ts](route-registrar.spec.ts)       | 최소 프로브 앱과 메타데이터로 CRUD·관계 라우트, 읽기 전용·upsert·writeGuards를 검사한다.   |

## AI 에이전트 지침

- 이 디렉터리는 PostgreSQL을 사용하지 않는다. route-registrar는 AppModule 없이
  최소 컨트롤러와 가드만 조립해 실제 HTTP와 메타데이터를 확인하는 의도적인 프로브다.
  운영 앱 전체 검사는 createTestApp을 사용하는 다른 스위트에 둔다.
- 관계 읽기는 시리얼라이저 선언, 관계 쓰기는 쓰기 스키마와의 교집합으로 확인한다.
  enableWrites가 거짓이면 관계 쓰기도 없어야 한다.
- writeGuards는 자원 쓰기와 관계 변경을 막되 읽기는 열어 두는 양쪽을 검사한다.
- 구조 오류의 JsonApiError와 속성 검증의 JsonApiErrors를 구분한다. presentKeys에는
  명시적 null을 포함한 원본 요청 키만 담고, 생략된 속성을 덮어쓰지 않는지 확인한다.
- 프로브 앱은 종료 시 닫고, 실제 저장 후 실패의 롤백 증명은 이곳 단위 검사로
  대체하지 않는다. 상세 회귀 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

## 검증

저장소 루트에서 실행한다. 외부 서비스는 필요 없다.

```bash
pnpm test:controllers --runInBand
pnpm typecheck
```

## 의존성

src/app/controllers/concerns와 자원 모델·스키마·시리얼라이저 선언을 가져온다.
Jest, Nest Testing·Reflect 메타데이터, Supertest, class-validator를 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
