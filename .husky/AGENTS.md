<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# .husky

## 목적

커밋 전에 staged 파일 검사와 프로젝트 타입 검사를 실행하는 Git 훅을 보관합니다.

## 주요 파일

| 파일         | 설명                                                            |
| ------------ | --------------------------------------------------------------- |
| `pre-commit` | `pnpm exec lint-staged` 다음 `pnpm run typecheck`를 실행합니다. |

## 하위 디렉터리

`_/`는 Husky가 생성하고 자체 `.gitignore`로 제외하는 훅 래퍼입니다. 직접 편집하거나
AGENTS.md를 생성하지 않습니다.

## AI 에이전트 지침

### 작업 시 주의사항

- 훅 진입점은 간단하게 유지하고 파일 패턴별 동작은 루트 `package.json`의
  `lint-staged` 설정에서 관리합니다.
- `prepare: husky` 설치 경로를 유지합니다. 줄바꿈은 `.gitattributes`에 맞춰 LF를 사용합니다.

### 테스트 요구사항

- 저장소 루트에서 `pnpm typecheck`로 두 번째 단계의 동작을 확인합니다.
- lint-staged 설정을 바꾼 경우 의도한 staged 파일을 대상으로 검사합니다.
  `pnpm exec lint-staged`는 ESLint/Prettier를 통해 해당 파일을 수정할 수 있습니다.
- 훅 검증을 위해 불필요한 커밋을 만들지 말고 명령과 파일 패턴을 직접 확인합니다.

### 공통 패턴

TypeScript staged 파일은 ESLint 자동 수정과 Prettier, 문서/설정은 Prettier,
모든 staged 파일은 secretlint를 거칩니다. 이어 전체 소스와 테스트를 타입 검사합니다.

## 의존성

### 내부

`package.json`의 `prepare`, `lint-staged`, `typecheck`와 ESLint/Prettier/secretlint 설정.

### 외부

Git, Husky, pnpm, lint-staged, ESLint, Prettier, secretlint, TypeScript.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
