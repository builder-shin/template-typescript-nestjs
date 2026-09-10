<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src

## 목적

애플리케이션 계층, 실행 조립과 데이터베이스 변경을 나누어 관리합니다.
JSON:API 프로토콜과 선언형 CRUD, 인증, 비동기 작업, 마이그레이션과 시드를 구현합니다.

## 하위 디렉터리

| 디렉터리  | 역할                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ |
| `app/`    | 모델·스키마·표현·컨트롤러·프로토콜·인증·잡. [app/AGENTS.md](app/AGENTS.md) 참고.           |
| `config/` | 설정, 앱과 라우트, HTTP, OpenAPI, DB 연결 조립. [config/AGENTS.md](config/AGENTS.md) 참고. |
| `db/`     | 스키마 마이그레이션과 결정적 시드. [db/AGENTS.md](db/AGENTS.md) 참고.                      |

## AI 에이전트 지침

- 상대 TypeScript import에 출력 파일 기준 `.js`를 붙이고 타입 전용 참조에는
  `import type`을 사용합니다.
- 엔티티·마이그레이션·컨트롤러는 명시적 레지스트리로 등록합니다. 스키마 변경은
  새 마이그레이션으로 전달하며 루트 문서의 계층별 변경 순서를 따릅니다.
- 운영 시작점과 `../test/app-factory.ts`의 HTTP 설정 및 OpenAPI 등록 순서를 맞춥니다.
- API 모듈 그래프에 Redis broker를 추가하지 않습니다. 워커는 독립 프로세스입니다.
- 상태 확인은 일반 JSON으로 응답합니다. readiness는 DB 연결을 확인합니다.

## 테스트 요구사항

저장소 루트에서 `pnpm typecheck`와 하위 지침의 관련 테스트를 실행합니다.
HTTP/DB 검사는 전용 `TEST_DATABASE_URL`, 큐 통합 검사는 `TEST_REDIS_URL`도 필요합니다.
`./scripts/check.sh`가 없는 테스트 인프라를 준비하고 전체 검증 후 정리합니다.
출력 모듈을 변경하면 `pnpm build`도 확인합니다. 커버리지 제외 목록은 `jest.config.js`를 따릅니다.

## 의존성

NestJS/Express/Swagger, TypeORM/PostgreSQL, class-validator/class-transformer,
JWT/argon2, BullMQ/Redis를 사용합니다. 루트 TypeScript 설정과 `../test/`가 소스를 검증합니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존한다. -->
