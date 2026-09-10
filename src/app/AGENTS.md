<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app

## 목적

HTTP 동작과 프로토콜 정의를 모으는 디렉터리입니다. 현재 상태 확인 컨트롤러와
JSON:API 미디어 타입 상수만 있으며, 모듈 조립과 환경 설정은 `../config/`에서 관리합니다.

## 하위 디렉터리

| 디렉터리       | 역할                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `controllers/` | 일반 JSON으로 응답하는 상태 확인 컨트롤러. [controllers/AGENTS.md](controllers/AGENTS.md) 참고. |
| `jsonapi/`     | JSON:API vendor 미디어 타입 정의. [jsonapi/AGENTS.md](jsonapi/AGENTS.md) 참고.                  |

## AI 에이전트 지침

- 새 컨트롤러는 `../config/routes.module.ts`에 명시적으로 등록합니다.
- 상태 확인은 JSON:API 협상 대상이 아닙니다. 현재 준비 상태 응답에는 DB 확인이 없습니다.
- 앱을 사용하는 테스트는 `../../test/app-factory.ts`의 `createTestApp()`을 공유합니다.
- 저장소 루트에서 `pnpm typecheck`와 아래 대상 테스트를 실행합니다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/health.controller.spec.ts test/jsonapi/media-type.spec.ts test/config/routes.module.spec.ts test/config/openapi.spec.ts
```

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
