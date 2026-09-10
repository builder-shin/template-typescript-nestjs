<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/config

## 목적

NestJS 애플리케이션의 시작점, 모듈 조립, 공개 라우트 등록, OpenAPI와 환경 변수 해석을
관리합니다. 현재 설정 로더는 HTTP 포트만 읽으며 DB, 인증, 캐시 연결은 구현하지 않습니다.

## 주요 파일

| 파일               | 설명                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `main.ts`          | 메타데이터 초기화, 설정 로드, 앱 생성, OpenAPI 등록 후 `0.0.0.0`에서 수신하는 실행 진입점. |
| `app.module.ts`    | `RoutesModule`을 가져오는 루트 Nest 모듈.                                                  |
| `routes.module.ts` | 공개 컨트롤러의 유일한 명시적 등록 지점. 현재 `HealthController`만 등록합니다.             |
| `openapi.ts`       | Swagger UI `/api-docs`와 JSON 스키마 `/api/schema`를 등록합니다.                           |
| `settings.ts`      | `SettingsError`, 환경 변수 파싱 함수, `ServerSettings`, `loadServerSettings()` 정의.       |

## AI 에이전트 지침

### 작업 시 주의사항

- 컨트롤러 자동 탐색을 추가하지 않습니다. 공개 라우트는 `RoutesModule.controllers`에서
  조립하고, 변경 시 실제 등록 목록과 OpenAPI 경로의 고정 비교 테스트를 갱신합니다.
- `setupOpenApi()`는 `app.init()` 전에 호출합니다. `main.ts`와
  `../../test/app-factory.ts`의 설정 순서가 일치해야 합니다.
- Swagger CLI 플러그인에 의존하지 않습니다. 빌드는 `tsc`를 사용하며 스키마 정보는
  `@ApiProperty` 등의 명시적 데코레이터로 표현합니다.
- 현재 인증된 라우트가 없으므로 `.addBearerAuth()`를 등록하지 않습니다. 첫 인증
  라우트를 구현할 때 해당 operation의 인증 데코레이터와 함께 검토합니다.
- 전역 미들웨어나 필터를 추가하면 `AppModule`에서 등록 순서도 검토합니다.
- 환경 변수 해석은 `settings.ts`의 프리미티브를 사용하고 변수 이름이 포함된 오류를
  유지합니다. 함수의 환경 객체 인자를 활용해 설정 테스트를 격리합니다.

### 설정 계약과 공통 패턴

- `requireEnv()`는 누락되거나 공백뿐인 값을 거부하고, 유효한 문자열은 그대로 반환합니다.
- `optionalInteger()`는 누락 또는 빈 값에만 fallback을 사용합니다. 앞뒤 공백을 제거한
  십진 정수 문자열을 허용하며 음수도 정수로 해석합니다.
- `optionalNonNegativeInteger()`는 음수를 거부하고 `0`을 허용합니다.
- `loadServerSettings()`는 `PORT`를 읽고 기본값 `4000`을 사용합니다. 현재 포트 상한과
  안전한 정수 범위 검증은 없습니다.
- 파싱 함수는 기본적으로 `process.env`를 읽습니다. 부트스트랩은 설정을 먼저 해석한 뒤
  앱을 만들며 최상위 `await`로 실행합니다.

### 테스트 요구사항

저장소 루트에서 `pnpm typecheck`와 다음 테스트를 실행합니다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/config/settings.spec.ts test/config/routes.module.spec.ts test/config/openapi.spec.ts test/health.controller.spec.ts
```

시작점이나 출력 모듈을 변경하면 `pnpm build`도 실행합니다. `main.ts`는 Jest 커버리지
대상에서 제외됩니다. 전체 커버리지 검증은 `pnpm test --runInBand`를 사용합니다.

## 의존성

### 내부

`RoutesModule`은 `../app/controllers/health.controller.ts`를 등록합니다. 테스트 앱은
`../../test/app-factory.ts`에서 같은 `AppModule`과 OpenAPI 설정을 사용합니다.

### 외부

`@nestjs/common`의 모듈과 앱 타입, `@nestjs/core`의 `NestFactory`,
`@nestjs/swagger`의 문서 생성 및 UI, `reflect-metadata`의 데코레이터 메타데이터를
사용합니다. 기본 HTTP 어댑터는 설치된 `@nestjs/platform-express`입니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
