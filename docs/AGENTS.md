<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# docs

## 목적

NestJS JSON:API 템플릿의 설계와 단계별 구현 계획을 보관한다. 문서는 향후 구현할 계약도
포함하므로 현재 기능의 근거는 실제 소스, 테스트와 `README.md`에서 확인한다. 현재 구현은
Phase 0이며 JSON:API 처리, 영속성, 인증과 비동기 작업은 후속 단계의 계획이다.

## 하위 디렉터리

| 디렉터리       | 역할                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| `superpowers/` | 전체 설계와 Phase 0 구현 계획. [superpowers/AGENTS.md](superpowers/AGENTS.md)를 참고한다. |

## 작업 지침

- 한국어 기록의 제목, 표, 코드 블록, 체크리스트와 결정 근거를 보존한다.
- 루트 `.prettierignore`는 `docs/`를 제외한다. 문서 작업에 무관한 일괄 재포맷을 피한다.
- 문서의 명령과 체크리스트를 문서 정리 작업의 실행 지시로 취급하지 않는다. 파일이
  존재한다는 이유만으로 구현 완료 표시를 추가하지 않는다.
- 저장소 루트의 `.superpowers/`는 무시되는 실행 기록이며 이 디렉터리와 구분한다.
- 변경 후 상대 링크와 Markdown 구조를 확인한다. 검증 명령을 바꾸면 `README.md`,
  `test/docs/readme.spec.ts`, `scripts/check.sh`와의 일치 여부도 확인한다.

## 의존 관계

`superpowers/specs/`의 설계 계약을 `superpowers/plans/`에서 단계별 절차로 구체화한다.
현재 구현에 관한 설명은 `src/`, `test/`, 루트 실행·검증 설정과 일치해야 한다.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
