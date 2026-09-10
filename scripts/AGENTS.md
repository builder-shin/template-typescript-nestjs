<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# scripts

## 목적

로컬과 CI가 공유하는 전체 검증 게이트를 보관합니다.

## 주요 파일

| 파일       | 설명                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| `check.sh` | 필요한 PostgreSQL/Redis를 격리해 시작하고 다섯 검사를 순서대로 실행한 뒤 정리합니다. |

## AI 에이전트 지침

### 작업 시 주의사항

- `set -euo pipefail`, 저장소 루트 기준 실행, `trap cleanup EXIT`를 유지합니다.
- 외부에서 제공한 `TEST_DATABASE_URL`과 `TEST_REDIS_URL`을 각각 독립적으로 존중합니다.
  둘 중 하나만 제공되어도 나머지 서비스만 준비해야 합니다.
- 임시 스택은 PID와 난수를 포함한 프로젝트 이름 및 `TEST_DB_PORT=0`, `TEST_REDIS_PORT=0`으로
  격리합니다. 시작 전에 `started_test_services`를 켜 부분적으로 생성된 스택도 정리합니다.
- EXIT 정리는 스크립트가 생성한 Compose 프로젝트에만 적용합니다. 외부 URL의 서비스는
  종료하지 않습니다. 테스트에는 전용 DB/Redis 인스턴스를 사용합니다.
- 검사 순서는 ESLint → Prettier → TypeScript → 커버리지 Jest → secretlint입니다.
  검사 명령을 바꾸면 텍스트 계약 테스트, package 스크립트, README, CI를 함께 확인합니다.
- 실행 파일 모드와 LF 줄바꿈을 유지합니다. Bash 배열과 변수 확장을 사용하므로
  Windows에서는 Git Bash 또는 WSL이 필요합니다.

### 테스트 요구사항

저장소 루트에서 실행합니다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/scripts/check-script.spec.ts
bash -n scripts/check.sh
```

스크립트 동작 변경은 `./scripts/check.sh`로 실제 검증합니다. 두 테스트 URL 중 하나라도
없으면 Docker가 필요합니다. 텍스트 테스트만으로 서비스 생성과 정리 성공을 입증할 수 없습니다.
현재 전체 Jest 테스트는 실제 PostgreSQL과 Redis를 사용합니다.

### 공통 패턴

스크립트 위치에서 저장소 루트를 계산하고, Compose 인자는 Bash 배열로 전달합니다.
검사 실패 시 즉시 종료하며 EXIT 훅에서 생성한 테스트 서비스와 볼륨까지 정리합니다.

## 의존성

### 내부

`docker-compose.test.yml`, `package.json`, 검사 도구 설정,
`test/scripts/check-script.spec.ts`, `.github/workflows/ci.yml`.

### 외부

Bash, pnpm, Docker Compose, PostgreSQL/Redis 이미지, ESLint, Prettier, TypeScript, Jest, secretlint.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
