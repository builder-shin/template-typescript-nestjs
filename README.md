# TypeScript NestJS Template

NestJS 12, TypeORM, PostgreSQL로 구성할 JSON:API 1.1 템플릿입니다. 현재 Phase 0(기반과 검증 게이트)까지 구현되어 있습니다.

## 요구 사항

- Node.js 24.11.0 이상
- pnpm 11
- Docker (검증 게이트와 Compose 스택에 필요합니다)

## 구조

```text
src/app/          # 컨트롤러와 JSON:API 미디어 타입 상수
src/config/       # 조립점 (앱 모듈, 명시 라우트, 설정, OpenAPI)
test/             # 단위 테스트
scripts/check.sh  # 단일 검증 게이트
```

Phase 0은 기반만 담습니다. JSON:API 프로토콜 구현, 리소스 컨트롤러, 데이터베이스 계층, 인증, 백그라운드 잡은 아직 없습니다. `scripts/check.sh`가 임시 PostgreSQL을 띄우지만 현재 그것을 사용하는 테스트는 없으며, 데이터베이스 통합 테스트는 Phase 2에서 추가됩니다. 전체 설계는 `docs/superpowers/specs/`를 참고하세요.

## ESM 제약

이 템플릿은 ESM 패키지입니다(`"type": "module"`). NestJS 12가 ESM 전용이라 선택이 아니라 전제입니다.

**모든 상대 import에 `.js` 확장자를 붙여야 합니다.**

```ts
import { AppModule } from './app.module.js'; // 올바름
import { AppModule } from './app.module'; // TS2835 오류
```

`pnpm typecheck`가 이 규칙의 게이트입니다. 별도 린트 규칙은 두지 않습니다.

TypeScript는 6.0.3에 고정되어 있습니다. 7.x는 네이티브 컴파일러라 JS 컴파일러 API를 노출하지 않아 `ts-jest`와 `typescript-eslint`가 동작하지 않습니다.

이 저장소는 `.gitattributes`로 줄바꿈을 LF로 고정합니다. Windows에서는 Git for Windows의 시스템 기본 설정인 `core.autocrlf=true`를 따르면 체크아웃 시 텍스트 파일이 CRLF로 바뀌는데, Prettier의 기본값인 `endOfLine: "lf"` 검사가 이를 오류로 처리합니다. 그러면 새로 클론한 환경에서 `pnpm format:check`가, 나아가 이를 포함하는 `scripts/check.sh` 게이트가 곧바로 깨집니다.

## 로컬 실행

```bash
pnpm install
pnpm build
pnpm start
```

- API: `http://localhost:4000`
- OpenAPI 문서: `http://localhost:4000/api-docs`
- OpenAPI 스키마: `http://localhost:4000/api/schema`
- 상태 확인: `http://localhost:4000/health/live`, `http://localhost:4000/health/ready`

## Docker로 실행

```bash
docker compose up -d --build --wait
curl -s http://localhost:4000/health/ready
docker compose down -v
```

## 환경 변수

| 변수                | 기본값            | 비고                                                 |
| ------------------- | ----------------- | ---------------------------------------------------- |
| `PORT`              | `4000`            | 정수가 아니면 `PORT must be an integer`로 실패합니다 |
| `POSTGRES_DB`       | `nestjs_template` | Compose 전용입니다                                   |
| `POSTGRES_USER`     | `nestjs`          | Compose 전용입니다                                   |
| `POSTGRES_PASSWORD` | `nestjs`          | Compose 전용 개발 값입니다                           |

애플리케이션 코드에는 암묵적 기본값이 없습니다. 값이 잘못되면 변수 이름이 담긴 오류와 함께 프로세스가 시작되지 않습니다.

## 개별 검사

```bash
pnpm build         # tsc -p tsconfig.build.json
pnpm start         # node dist/config/main.js
pnpm lint          # eslint .
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
pnpm typecheck     # tsc --noEmit -p tsconfig.json
pnpm test          # jest (커버리지 게이트 80% 포함)
pnpm test:quick    # jest (커버리지 없이 빠르게)
pnpm secretlint    # 비밀 정보 탐지
pnpm check         # ./scripts/check.sh 전체 게이트
```

`check`를 제외한 모든 태스크는 bash 없이 Windows에서 동작합니다. `check`는 bash 스크립트이므로 Git Bash 또는 WSL이 필요합니다.

## 검증

전체 검사는 격리된 실제 PostgreSQL 테스트 DB를 자동으로 실행하고 정리합니다.

```bash
pnpm install --frozen-lockfile
./scripts/check.sh
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

검사 범위는 ESLint, Prettier, strict TypeScript, Jest와 커버리지, 비밀 정보 탐지입니다. 타입 검사는 `src`뿐 아니라 `test`까지 포함합니다.
