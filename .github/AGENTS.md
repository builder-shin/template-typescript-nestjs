<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# .github

## 목적

GitHub Actions 기반 CI 설정을 모읍니다. 현재 워크플로는 로컬과 같은 검증 게이트를
실행하고 Compose 설정, 운영 Docker 이미지 빌드, 전체 스택 기동과 정리를 확인합니다.

## 하위 디렉터리

| 디렉터리     | 역할                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| `workflows/` | CI 실행 조건과 검사 단계. [workflows/AGENTS.md](workflows/AGENTS.md) 참고. |

## AI 에이전트 지침

- 검사 내용은 루트 `scripts/check.sh`와 공유하고, 도구 버전은 `package.json`과 맞춥니다.
- 워크플로 변경 시 YAML 형식, 실행 조건, 권한, 단계 순서를 확인합니다.
- 상세 검사 방법과 의존성은 하위 지침을 따릅니다.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
