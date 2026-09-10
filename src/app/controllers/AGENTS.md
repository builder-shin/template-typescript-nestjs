<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/controllers

## 목적

HTTP 요청을 처리하는 NestJS 컨트롤러를 둡니다. 현재 상태 확인 컨트롤러만 구현되어
있으며 리소스 라우트는 없습니다.

## 주요 파일

| 파일                   | 설명                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `health.controller.ts` | `HealthStatus` 인터페이스와 `/health/live`, `/health/ready` GET 엔드포인트를 정의합니다. |

## AI 에이전트 지침

### 작업 시 주의사항

- 두 엔드포인트는 현재 HTTP 200과 `{ status: 'ok' }`를 반환합니다.
  `HealthStatus.status`는 `readonly string`입니다.
- 응답은 일반 `application/json`이며 JSON:API vendor 타입을 사용하지 않습니다.
  추후 협상 로직을 추가하더라도 상태 확인은 협상 대상에서 제외합니다.
- liveness는 외부 자원을 확인하지 않습니다. readiness도 현재 고정 응답이며
  데이터베이스 확인은 후속 구현 계획입니다.
- 컨트롤러는 `../../config/routes.module.ts`에 명시적으로 등록해야 노출됩니다.
  엔드포인트를 바꾸면 라우트와 OpenAPI 경로 계약도 함께 검토합니다.

### 테스트 요구사항

저장소 루트에서 `pnpm typecheck`와 다음 명령을 실행합니다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/health.controller.spec.ts test/config/routes.module.spec.ts test/config/openapi.spec.ts
```

상태 확인 테스트는 응답 상태와 본문, 일반 JSON Content-Type, 없는 경로의 404를
검증합니다. HTTP 테스트는 `../../../test/app-factory.ts`의 `createTestApp()`을 사용하고
테스트가 끝나면 앱을 닫습니다.

## 의존성

- 내부: `../../config/routes.module.ts`의 공개 등록과 `../../../test/`의 HTTP 및 경로 계약 테스트.
- 외부: `@nestjs/common`의 `Controller`, `Get` 데코레이터.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
