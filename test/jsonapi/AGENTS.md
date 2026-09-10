<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/jsonapi

## 목적

JSON:API 미디어 타입 상수의 값을 검증한다. 현재 이 디렉터리의 검사는 상수 하나만 다룬다.

## 주요 파일

| 파일                 | 설명                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `media-type.spec.ts` | `JSONAPI_MEDIA_TYPE`이 `application/vnd.api+json`인지 정확히 비교한다. |

## AI 에이전트 지침

### 작업 시 주의사항

- 미디어 타입의 기준은 `src/app/jsonapi/media-type.ts`의 상수다.
- 현재 미디어 타입 협상, JSON:API 문서 처리, 리소스 라우트는 구현되어 있지 않다.
  이 상수 테스트를 해당 동작의 검증으로 설명하지 않는다.
- health 응답은 일반 JSON이며 이 상수를 사용하지 않는다. 관련 HTTP 계약은
  `test/health.controller.spec.ts`에서 검사한다.

### 테스트 요구사항

저장소 루트에서 다음 명령을 실행한다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/jsonapi/media-type.spec.ts
```

TypeScript 코드를 수정했다면 `pnpm typecheck`도 실행한다. 앱 조립이나 외부 서비스는
필요하지 않다.

### 공통 패턴

상수 모듈을 `.js` 확장자가 있는 상대 경로로 직접 import하고 Jest의 `toBe`로 비교한다.

## 의존성

### 내부

`src/app/jsonapi/media-type.ts`에 의존한다. 공통 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

### 외부

Jest를 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
