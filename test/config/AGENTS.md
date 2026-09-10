<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/config

## 목적

환경 설정과 DB·브로커 연결 옵션의 순수 검사, 운영 모듈로 조립한 실제 HTTP·라우트·
OpenAPI 검사를 함께 둔다. 파일별로 외부 서비스 필요 여부가 다르다.

## 주요 파일

| 파일                                           | 설명                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [settings.spec.ts](settings.spec.ts)           | 환경 변수 파서, 서버·DB·JWT·워커 기본값과 범위, 서명 키 UTF-8 바이트 하한을 검사한다.       |
| [database.spec.ts](database.spec.ts)           | PostgreSQL 옵션, 명시 등록 배열, 풀 전달, synchronize와 migrationsRun의 false를 검사한다.   |
| [broker.spec.ts](broker.spec.ts)               | jobs 큐 이름, redis/rediss URL의 원본 전달, 임의 연결 옵션을 덧붙이지 않는 계약을 검사한다. |
| [http.spec.ts](http.spec.ts)                   | 초기화 전 프로브로 일반 JSON·vendor 본문 파서와 simple 질의 파서를 확인한다.                |
| [routes.module.spec.ts](routes.module.spec.ts) | CRUD·관계·auth·users/me·health 전체 라우트 집합과 참조 자원의 읽기 전용 노출을 검사한다.    |
| [openapi.spec.ts](openapi.spec.ts)             | /api/schema 응답, 문서 경로 집합, Bearer 스킴과 쓰기·users/me의 보안 표시를 검사한다.       |

## AI 에이전트 지침

- settings·database·broker 검사는 외부 서비스에 연결하지 않는다. http·routes.module·
  openapi 검사는 [app-factory.ts](../app-factory.ts)의 createTestApp을 거치므로
  실제 PostgreSQL과 TEST_DATABASE_URL이 필요하다.
- 공개 라우트를 바꾸면 Express 표기와 OpenAPI의 {id} 표기를 각각 갱신한다.
  보안 스킴 등록, 동적 CRUD 쓰기, 공개 읽기를 모두 확인한다.
- 본문 파서 프로브는 beforeInit 훅에 등록한다. app.init 뒤의 라우트는 Nest의
  not-found 핸들러에 가려질 수 있다. 앱은 종료 시 닫는다.
- 설정에는 명시적 환경 객체를 전달한다. process.env 기본 인자를 검사하려고 전역을
  바꿀 때에는 스냅샷을 복원하고 테스트가 만든 새 키도 지운다.

## 검증

다음 첫 명령은 외부 서비스 없이 실행할 수 있다. 전체 디렉터리를 실행하는 두 번째
명령 전에는 테스트 PostgreSQL을 준비한다. 전체 게이트가 필요하면 루트 가이드를 따른다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/config/settings.spec.ts test/config/database.spec.ts test/config/broker.spec.ts
pnpm test:quick --runInBand test/config
pnpm typecheck
```

## 의존성

src/config의 settings·database·broker·http·routes.module·openapi와 테스트 앱 팩토리에
의존한다. Jest, Nest Testing, Supertest, TypeORM과 HTTP 검사용 PostgreSQL을 사용한다.
공통 격리 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
