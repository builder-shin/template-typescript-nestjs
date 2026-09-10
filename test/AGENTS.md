<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test

## 목적

Jest로 설정, HTTP 응답, 문서와 검증 스크립트의 계약을 검사한다. 현재 테스트는
PostgreSQL을 사용하지 않는다. Nest 애플리케이션 조립은 공통 팩토리에 모은다.

## 주요 파일

| 파일                        | 설명                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `setup.ts`                  | Jest 실행 전에 `reflect-metadata`를 불러온다.                                            |
| `app-factory.ts`            | `AppModule`로 테스트 앱을 조립하고 OpenAPI를 등록하며, 실제 공개 라우트 목록을 추출한다. |
| `health.controller.spec.ts` | 두 상태 확인 경로의 200 응답과 본문, 일반 JSON 미디어 타입, 없는 경로의 404를 검사한다.  |

## 하위 디렉터리

| 디렉터리   | 역할                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| `config/`  | 환경 설정, 명시적 라우트와 OpenAPI 계약 ([가이드](config/AGENTS.md)).        |
| `docs/`    | README 구조와 검증 명령 계약 ([가이드](docs/AGENTS.md)).                     |
| `jsonapi/` | JSON:API 미디어 타입 상수 검사 ([가이드](jsonapi/AGENTS.md)).                |
| `scripts/` | 검증 셸 스크립트의 정리 동작과 검사 순서 확인 ([가이드](scripts/AGENTS.md)). |

## AI 에이전트 지침

### 작업 시 주의사항

- 애플리케이션 테스트는 `createTestApp()`을 사용한다. 개별 테스트에서
  `Test.createTestingModule()`로 다른 조립점을 만들지 않는다.
- 팩토리는 `setupOpenApi()`를 `app.init()` 전에 호출한다. 운영 부트스트랩과
  테스트 조립 방식이 일치하도록 유지한다.
- HTTP 서버는 `INestApplication<Server>`로 타입을 지정한다. Supertest의
  `response.body`는 명시적인 응답 인터페이스로 좁힌 뒤 단언한다.
- `registeredRoutes()`는 Express의 `router.stack`을 읽어 정렬된 `METHOD /path`
  목록을 만든다. `/api/schema`와 `/api-docs`로 시작하는 문서 경로는 제외하며,
  OpenAPI HTTP 응답은 별도 테스트에서 확인한다. 어댑터 변경 시 이 추출기도 검토한다.

### 테스트 요구사항

모든 명령은 저장소 루트에서 실행한다. 관련 자식 가이드의 개별 테스트를 먼저 실행하고,
테스트 코드 수정 시 타입 검사도 실행한다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/health.controller.spec.ts
pnpm typecheck
pnpm test:quick --runInBand
```

전체 커버리지 게이트는 `pnpm test --runInBand`다. 전역 statements, branches,
functions, lines 각각 80%를 요구하며 `src/config/main.ts`는 수집 대상에서 제외된다.
개별 테스트에는 커버리지를 끄는 `test:quick`을 사용한다. 현재 Jest 테스트에는 Bash나
Docker가 필요하지 않지만, 전체 검증 게이트 `scripts/check.sh`는 별도 환경을 요구한다.

### 공통 패턴

- 파일 이름은 `*.spec.ts`이며 Jest 전역 `describe`, `it`, `expect`를 사용한다.
- 상대 TypeScript import에는 `.js`를 붙이고 타입 전용 의존성에는 `import type`을 쓴다.
- 앱은 `beforeAll`에서 만들고 `afterAll`에서 `await app.close()`로 정리한다.
- 설정 테스트에는 환경 변수 객체를 전달하며, `process.env`를 직접 바꾸면 원상 복구한다.
- 테스트 설명과 주석은 한국어로 작성하고 파일은 UTF-8, LF를 유지한다.

## 의존성

### 내부

`src/config/`의 앱 조립과 설정, `src/app/`의 컨트롤러와 프로토콜 상수를 검증한다.
`jest.config.js`가 ESM ts-jest 변환과 메타데이터 초기화를 설정하고, `tsconfig.json`과
`eslint.config.js`가 테스트에도 엄격한 타입 검사와 린트 규칙을 적용한다.

### 외부

Jest, ts-jest, `@nestjs/testing`, Supertest, `reflect-metadata`, Node HTTP 타입을 사용한다.
`package.json`의 테스트 스크립트가 Node의 `--experimental-vm-modules` 옵션을 제공한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
