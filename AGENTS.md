<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# template-typescript-nestjs

## 목적

NestJS 12와 TypeScript로 만드는 JSON:API 1.1 템플릿의 기반입니다. 현재 체크아웃은
Phase 0으로, 일반 JSON 상태 확인 엔드포인트, OpenAPI, 환경 변수 파싱, 검증 도구를
구현합니다. JSON:API 협상, 리소스 컨트롤러, TypeORM 영속성, 인증, 백그라운드 잡은
설계 문서의 후속 계획입니다. Compose에 PostgreSQL과 Redis가 정의되어 있지만
현재 애플리케이션은 두 서비스에 연결하지 않습니다.

## 주요 파일

| 파일                      | 설명                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `README.md`               | 실행 방법, 현재 구현 범위, 엔드포인트, 표준 검증 명령.                                         |
| `package.json`            | ESM 설정, 고정 의존성, 스크립트, lint-staged 규칙. Node >=24.11.0과 pnpm 11.22.0을 지정합니다. |
| `pnpm-lock.yaml`          | frozen 설치에 사용하는 자동 생성 의존성 잠금 파일.                                             |
| `pnpm-workspace.yaml`     | 의존성 빌드 허용 정책과 잠금 파일에 반영되는 Jest 관련 overrides.                              |
| `tsconfig.json`           | 소스와 테스트의 strict 타입 검사, Node ESM 해석, 데코레이터 메타데이터 설정.                   |
| `tsconfig.build.json`     | `src/`만 `dist/`로 컴파일하며 진입점은 `dist/config/main.js`입니다.                            |
| `eslint.config.js`        | 타입 기반 strict 검사, 명시적 함수 반환 타입, type import 규칙.                                |
| `jest.config.js`          | ESM ts-jest 실행, 테스트 탐색, 메타데이터 초기화, 전역 커버리지 80% 기준.                      |
| `.prettierrc.json`        | 작은따옴표, 세미콜론, 후행 쉼표, 출력 폭 100 설정.                                             |
| `.prettierignore`         | 생성물, 의존성, 잠금 파일, 설계 문서, 실행 스크래치의 포맷 검사 제외.                          |
| `.secretlintrc.json`      | secretlint 권장 규칙 프리셋.                                                                   |
| `.gitattributes`          | Windows를 포함한 텍스트 파일의 LF 줄바꿈 고정.                                                 |
| `.gitignore`              | 의존성, 빌드/커버리지 출력, 로컬 환경 파일, 로그, `.superpowers/` 제외.                        |
| `.env.example`            | `PORT`와 개발용 PostgreSQL Compose 환경 변수 예시.                                             |
| `Dockerfile`              | Node 24 다단계 빌드, 운영 의존성 정리, 비특권 실행, readiness 헬스체크.                        |
| `.dockerignore`           | 개발 도구, 테스트, 문서, 로컬 출력 등을 빌드 컨텍스트에서 제외.                                |
| `docker-compose.yml`      | PostgreSQL 18, Redis 8, API 서비스. API 포트 게시도 `PORT`를 따릅니다.                         |
| `docker-compose.test.yml` | 전용 볼륨과 조절 가능한 루프백 포트를 사용하는 격리 PostgreSQL 테스트 서비스.                  |

## 하위 디렉터리

| 디렉터리   | 역할                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| `.github/` | CI 워크플로 설정. [.github/AGENTS.md](.github/AGENTS.md) 참고.                 |
| `.husky/`  | 유지보수하는 Git 훅 진입점. [.husky/AGENTS.md](.husky/AGENTS.md) 참고.         |
| `docs/`    | 전체 설계 명세와 Phase 0 구현 계획. [docs/AGENTS.md](docs/AGENTS.md) 참고.     |
| `scripts/` | 로컬과 CI가 공유하는 검증 게이트. [scripts/AGENTS.md](scripts/AGENTS.md) 참고. |
| `src/`     | 애플리케이션 동작과 실행 조립. [src/AGENTS.md](src/AGENTS.md) 참고.            |
| `test/`    | 단위, HTTP, 문서, 스크립트 계약 테스트. [test/AGENTS.md](test/AGENTS.md) 참고. |

`node_modules/`, `dist/`, `coverage/`, 자동 생성되는 `.husky/_/` 훅 래퍼와 Git에서
제외한 `.superpowers/` 실행 기록은 문서 생성 대상에서 제외합니다. 스크래치 보고서를
현재 체크아웃에 기능이 구현되어 있다는 근거로 사용하지 않습니다.

## AI 에이전트 지침

### 작업 시 주의사항

- 해당 영역의 하위 지침을 먼저 읽습니다. 문서 재생성 시 `<!-- MANUAL` 아래 내용을
  보존하고 UTF-8, LF로 저장합니다. 문서는 기존 명세에 맞춰 한국어로 작성합니다.
- 고정된 pnpm 버전을 사용하고 의존성 변경 시 pnpm으로 잠금 파일을 갱신합니다.
  Jest를 갱신할 때 `pnpm-workspace.yaml`의 관련 override 네 항목도 함께 검토합니다.
- TypeScript 6.0.3 고정은 README와 설계 명세에 기록된 ts-jest/typescript-eslint의
  컴파일러 API 호환성 결정입니다. 상위 버전으로 바꿀 때 두 도구의 호환성을 먼저 검증합니다.
- 상대 TypeScript import에는 출력 파일 기준 `.js` 확장자를 붙입니다. 타입 전용
  의존성은 `import type`, 함수 선언은 명시적 반환 타입을 사용합니다.
- 공개 컨트롤러는 `src/config/routes.module.ts`에 명시적으로 등록합니다.
  애플리케이션 테스트는 `test/app-factory.ts`를 공유하며 실제 부트스트랩과 조립을 맞춥니다.
- README는 현재 소스를 설명해야 합니다. 현재 readiness는 고정 응답이고, 현재 테스트는
  전체 게이트가 띄우는 PostgreSQL을 사용하지 않습니다.
- Docker 의존성 복사에 workspace 설정을 포함하고 builder의
  `pnpm prune --prod --ignore-scripts`를 유지합니다. 두 Compose 파일의 PostgreSQL
  저장소 마운트 경로는 `/var/lib/postgresql`입니다.

### 테스트 요구사항

명령은 저장소 루트에서 실행합니다. 개발 중에는 `pnpm test:quick --runInBand` 또는
하위 지침의 대상별 명령을 사용합니다. `pnpm typecheck`는 소스와 테스트를 검사하고
`pnpm build`는 애플리케이션 출력을 확인합니다. `pnpm test --runInBand`는 statements,
branches, functions, lines 각각 전역 80%를 요구하며 `src/config/main.ts`는 커버리지에서 제외합니다.

문서만 변경하면 해당 Markdown 형식과 링크를 확인하고
`pnpm test:quick --runInBand test/docs/readme.spec.ts`를 실행합니다. 현재 문서 테스트는
README만 검사하며 AGENTS.md 자체를 검사하지 않습니다.

### 전체 검증

README의 표준 검증 명령과 순서를 유지합니다.

```bash
pnpm install --frozen-lockfile
./scripts/check.sh
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

마지막 명령은 스택 볼륨을 삭제하므로 위 순서는 폐기 가능한 로컬 Compose 스택에서
실행합니다. `scripts/check.sh`는 Bash가 필요하며 Windows에서는 Git Bash 또는 WSL을
사용합니다. `TEST_DATABASE_URL`이 제공되지 않으면 임시 PostgreSQL을 시작하고,
ESLint → Prettier → TypeScript → 커버리지를 포함한 Jest → secretlint 순서로 검사한 뒤
자신이 시작한 DB 스택만 정리합니다. `check` 외 개별 package 스크립트에는 Bash가 필요 없습니다.

### 공통 패턴

- 네이티브 ESM, 최상위 `await`, Nest 데코레이터, `reflect-metadata` 초기화.
- 실행 조립은 `src/config/`, HTTP 동작과 프로토콜 정의는 `src/app/`에 배치.
- 환경 변수 객체를 주입하는 설정 테스트와 `readonly` 인터페이스.
- 한국어 소스 주석, 테스트 설명, 프로젝트 문서.

## 의존성

### 내부

실행 진입점은 `src/config/main.ts`입니다. README 검증 명령, `scripts/check.sh`,
CI, Docker 설정과 관련 테스트의 계약을 함께 맞춥니다.

### 외부

- 실행: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`,
  `reflect-metadata`, `rxjs`.
- 개발: TypeScript 6.0.3, ESLint/typescript-eslint, Prettier, Jest/ts-jest,
  `@nestjs/testing`, Supertest, secretlint, Husky, lint-staged.
- 환경: Node 24, pnpm 11.22.0, Bash, Docker Compose, PostgreSQL 및 Redis 이미지.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
