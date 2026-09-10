<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src

## 목적

애플리케이션 동작과 NestJS 실행 구성을 나누어 관리하는 소스 디렉터리다. 현재 구현은
상태 확인 엔드포인트, OpenAPI 문서, 환경 변수 파싱, JSON:API 미디어 타입 상수다.
JSON:API 협상, 리소스 라우트, 인증, 데이터베이스 연동은 아직 구현되지 않았다.

## 하위 디렉터리

| 디렉터리  | 역할                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `app/`    | HTTP 컨트롤러와 프로토콜 정의. [app/AGENTS.md](app/AGENTS.md) 참고.                                    |
| `config/` | 시작점, 모듈 조립, 명시적 라우트 등록, OpenAPI와 환경 설정. [config/AGENTS.md](config/AGENTS.md) 참고. |

## AI 에이전트 지침

### 작업 시 주의사항

- 동작 코드는 `app/`, 실행 및 조립 코드는 `config/`에 둔다.
- 상대 TypeScript import에는 출력 파일 기준 `.js` 확장자를 쓰고, 타입 전용 참조에는
  `import type`을 사용한다.
- 공개 컨트롤러는 `config/routes.module.ts`에 명시적으로 등록한다. 라우트가 바뀌면
  실제 라우트 목록과 OpenAPI 경로를 검증하는 테스트도 함께 검토한다.
- 운영 시작점과 `../test/app-factory.ts`의 앱 조립 및 OpenAPI 등록 순서를 맞춘다.
- 상태 확인 응답은 일반 JSON이며 JSON:API 협상 대상이 아니다. 준비 상태 응답은 현재
  외부 자원을 확인하지 않는 정적 응답이다.

### 테스트 요구사항

저장소 루트에서 `pnpm typecheck`와 `pnpm test:quick --runInBand`를 실행한다.
영역별 변경에는 자식 가이드의 대상 테스트를 사용할 수 있다. 시작점이나 모듈 출력에
영향을 주면 `pnpm build`도 실행한다. 전체 커버리지 검증은 `pnpm test --runInBand`이며,
`config/main.ts`는 커버리지 수집에서 제외된다.

## 의존성

런타임은 NestJS, Express 어댑터, Swagger, `reflect-metadata`를 사용한다. TypeScript
설정은 루트의 `tsconfig.json`과 `tsconfig.build.json`을 따르며, 소스 검증은 `../test/`에 있다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존한다. -->
