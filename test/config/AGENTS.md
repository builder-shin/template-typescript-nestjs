<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/config

## 목적

환경 변수 해석, 명시적인 공개 라우트 조립, OpenAPI 문서의 HTTP 계약을 검사한다.

## 주요 파일

| 파일                    | 설명                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `settings.spec.ts`      | 필수 값, 정수 파싱, 음수 거부, PORT 기본값과 재정의, 기본 `process.env` 사용을 검사한다. |
| `routes.module.spec.ts` | 실제 공개 애플리케이션 라우트가 두 health GET 경로와 정확히 일치하는지 검사한다.         |
| `openapi.spec.ts`       | `/api/schema`의 200 응답, OpenAPI 3.x, 버전 `0.1.0`, 정확한 문서 경로 목록을 검사한다.   |

## AI 에이전트 지침

### 작업 시 주의사항

- 앱 테스트는 `../app-factory.ts`의 `createTestApp()`을 사용하고 종료 시 앱을 닫는다.
- 공개 라우트를 추가하면 `routes.module.spec.ts`의 목록과 `openapi.spec.ts`의
  문서 경로 기대값을 함께 검토한다. 현재 계약은 `/health/live`, `/health/ready`다.
- 설정 테스트는 환경 변수 객체를 명시적으로 전달하는 방식을 우선한다.
  기본 인자 테스트에서 `process.env`를 바꾸면 기존 스냅샷을 복원하고 새 키를 제거한다.
- DB와 JWT 이름을 사용하는 설정 예시는 범용 파서 검사다. 현재 DB 연결이나 인증 기능을
  구현했다는 뜻으로 해석하지 않는다.

### 테스트 요구사항

저장소 루트에서 다음 명령을 실행한다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/config/settings.spec.ts test/config/routes.module.spec.ts test/config/openapi.spec.ts
pnpm typecheck
```

현재 이 테스트에는 데이터베이스나 실행 중인 별도 HTTP 서버가 필요하지 않다.

### 공통 패턴

- 설정 오류는 `SettingsError`와 변수 이름이 포함된 메시지로 단언한다.
- 라우트와 OpenAPI 경로는 정렬한 전체 목록으로 비교해 의도하지 않은 노출을 발견한다.
- HTTP 서버는 `Server` 타입으로 지정하고 응답 본문을 명시적인 인터페이스로 좁힌다.

## 의존성

### 내부

`src/config/settings.ts`, `src/config/routes.module.ts`, `src/config/openapi.ts`와
`test/app-factory.ts`에 의존한다. 공통 테스트 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

### 외부

Jest, Nest 애플리케이션 타입, Supertest와 Node HTTP 타입을 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
