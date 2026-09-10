<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# workflows

## 목적

GitHub Actions에서 의존성 설치, 공통 검증 게이트, Compose 설정 검사와 운영 이미지
빌드를 실행합니다.

## 주요 파일

| 파일     | 설명                                                           |
| -------- | -------------------------------------------------------------- |
| `ci.yml` | `main` push와 pull request에 반응하는 Ubuntu 기반 CI 워크플로. |

## AI 에이전트 지침

### 작업 시 주의사항

- `contents: read` 권한과 현재 이벤트 범위를 변경할 때 해당 필요성을 검토합니다.
- 현재 pnpm 설정은 11.22.0, Node 설정은 24이며 `package.json`과 맞춰 관리합니다.
- frozen 설치 후 `./scripts/check.sh`를 호출합니다. 검사 목록을 CI에 별도로 복제하지 않습니다.
- 이어 `docker compose config --quiet`와 `docker build --target runtime`을 실행합니다.
  CI 이미지 태그는 `template-typescript-nestjs:ci`이고 README 검증 예시는 `:verify`입니다.
- GitHub Actions 파일은 YAML이고 단계 이름은 기존 한국어 표현을 따릅니다.

### 테스트 요구사항

저장소 루트에서 `pnpm exec prettier --check .github/workflows/ci.yml`로 형식을 확인합니다.
실행 단계 변경 시 `./scripts/check.sh`, `docker compose config --quiet`,
`docker build --target runtime --tag template-typescript-nestjs:ci .`로 관련 동작을 확인합니다.
이 로컬 검사와 GitHub의 실제 이벤트/권한 처리는 구분해 보고합니다.

### 공통 패턴

checkout → pnpm 설정 → Node 설정 및 pnpm 캐시 → frozen 설치 → 공통 검사 →
Compose 설정 검증 → runtime 이미지 빌드 순서입니다.

## 의존성

### 내부

`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/check.sh`,
`docker-compose.yml`, `docker-compose.test.yml`, `Dockerfile`.

### 외부

GitHub Actions Ubuntu runner, `actions/checkout@v4`, `pnpm/action-setup@v4`,
`actions/setup-node@v4`, Node, pnpm, Bash, Docker Compose.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
