<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/jsonapi

## 목적

JSON:API 프로토콜 정의를 둡니다. 현재는 미디어 타입 상수만 있으며 리소스 라우트,
`Accept` 협상, 쓰기 요청의 `Content-Type` 검증, 미들웨어와 예외 필터는 구현되지 않았습니다.

## 주요 파일

| 파일            | 설명                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| `media-type.ts` | `JSONAPI_MEDIA_TYPE`을 `application/vnd.api+json` 문자열로 내보냅니다. |

## AI 에이전트 지침

### 작업 시 주의사항

- 현재 상수의 유일한 소비자는 `../../../test/jsonapi/media-type.spec.ts`입니다.
  이 상수의 존재만으로 요청 협상이나 JSON:API 응답 처리가 구현되었다고 설명하지 않습니다.
- 후속 협상 및 쓰기 요청 검증 구현은 이 공통 상수를 기준으로 연결합니다.
- `../controllers/health.controller.ts`는 일반 JSON을 반환하며 이 상수를 사용하지 않습니다.
  상태 확인 엔드포인트는 JSON:API 협상 대상에서 제외합니다.

### 테스트 요구사항

저장소 루트에서 `pnpm typecheck`와 다음 명령을 실행합니다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/jsonapi/media-type.spec.ts
```

현재 테스트는 상수의 정확한 문자열을 확인합니다. 요청 협상 등 동작을 추가하면
해당 동작을 검증하는 테스트도 추가해야 합니다.

## 의존성

현재 소스는 다른 모듈을 import하지 않으며 외부 런타임 의존성이 없습니다.
상수 테스트는 Jest를 사용합니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
