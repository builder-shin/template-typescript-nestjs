<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/controllers

## 목적

HTTP 상태 확인과 버전별 공개 API를 둡니다. 자원별 선언은 `api/v1/`, 공통 CRUD와
요청·응답 처리는 `concerns/`가 소유합니다.

## 주요 파일

| 파일                   | 설명                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `health.controller.ts` | `/health/live`의 생존 확인과 `SELECT 1`을 실행하는 `/health/ready`의 DB 준비 상태를 정의합니다. |

## 하위 디렉터리

| 디렉터리    | 역할                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| `api/`      | 버전별 자원·인증 라우트. [api/AGENTS.md](api/AGENTS.md) 참고.                          |
| `concerns/` | 선언형 CRUD 조립과 공통 요청·응답 처리. [concerns/AGENTS.md](concerns/AGENTS.md) 참고. |

## AI 에이전트 지침

### 작업 시 주의사항

- liveness는 외부 자원을 확인하지 않고 `{ status: 'ok' }`를 반환합니다.
  readiness는 DB 연결 성공 시 `{ status: 'ok', database: 'ok' }`를 반환합니다.
- 상태 확인 성공 응답은 일반 JSON입니다. `SkipJsonApiNegotiation`은 협상과 성공
  응답 인터셉터를 건너뛰지만 전역 오류 필터를 끄지 않습니다.
- readiness 실패 원인은 서버 로그에만 기록하고 클라이언트에는 JSON:API
  `INTERNAL_SERVER_ERROR`를 반환합니다.
- 컨트롤러는 `../../config/routes.module.ts`에 명시적으로 등록해야 노출됩니다.
  엔드포인트를 바꾸면 라우트와 OpenAPI 경로 계약도 함께 검토합니다.

### 테스트 요구사항

실제 PostgreSQL과 `TEST_DATABASE_URL`을 준비한 뒤 저장소 루트에서 `pnpm typecheck`와
다음 명령을 실행합니다. fixture 규칙은 [test/AGENTS.md](../../../test/AGENTS.md)를 봅니다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/health.controller.spec.ts test/config/routes.module.spec.ts test/config/openapi.spec.ts
```

공통 CRUD 조립의 DB 없는 검사는 `pnpm test:controllers --runInBand`로 실행합니다.
자원·인증 HTTP 동작은 `api/v1/` 가이드의 PostgreSQL 통합 검사를 따릅니다.

## 의존성

- 내부: `../../config/routes.module.ts`의 공개 등록과 `../../../test/`의 HTTP 및 경로 계약 테스트.
- 외부: NestJS, TypeORM, Swagger. 건강 상태 오류도 `../jsonapi/`의 오류 카탈로그를 사용합니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
