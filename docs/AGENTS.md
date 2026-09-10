<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# docs

## 목적

NestJS JSON:API 템플릿의 설계, 단계별 구현 계획과 실행 중 결정 기록을 보관한다.
Phase 0–8과 계약 통일 작업의 기록이 있으며, 현재 소스와 README에는 JSON:API 처리,
PostgreSQL 영속성, 선언형 CRUD·PUT, JWT 인증, BullMQ 작업과 참조 자원 읽기 라우트가
포함되어 있다. 과거 계획의 완료 조건과 당시 상태를 현재 동작으로 옮겨 적지 않는다.

## 하위 디렉터리

| 디렉터리       | 역할                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `superpowers/` | 설계 2개, 구현 계획 9개와 Phase 3–8 결정 기록 6개. [superpowers/AGENTS.md](superpowers/AGENTS.md) 참고. |

## 작업 지침

- 한국어 기록의 제목, 표, 코드 블록, 체크리스트와 결정 근거를 보존한다.
- 루트 `.prettierignore`는 `docs/`를 제외한다. 문서 작업에 무관한 일괄 재포맷을 피한다.
- 문서의 명령과 체크리스트를 문서 정리 작업의 실행 지시로 취급하지 않는다. 파일이
  존재한다는 이유만으로 구현 완료 표시를 추가하지 않는다.
- 저장소 루트의 `.superpowers/`는 무시되는 실행 기록이며 이 디렉터리와 구분한다.
- 변경 후 상대 링크와 Markdown 구조를 확인한다. 검증 명령을 바꾸면 `README.md`,
  `test/docs/readme.spec.ts`, `scripts/check.sh`와의 일치 여부도 확인한다.

## 확인 방법

저장소 루트에서 `pnpm test:quick --runInBand test/docs`, `pnpm format:check`,
`pnpm secretlint`를 실행한다. `docs/`는 기본 포맷 검사에서 빠지므로 변경한 안내 문서의
형식과 상대 링크도 직접 확인한다. 문서 테스트는 파일·경로와 정해진 명령 계약을
검사하며 역사 기록의 모든 문장이나 전체 안내 계층을 검증하지는 않는다.

## 의존 관계

`superpowers/specs/`의 설계 계약을 `superpowers/plans/`에서 절차로 구체화하고,
`superpowers/rulings/`에서 구현 중 판단과 설계 편차의 근거를 추적한다.
현재 사용법은 [README.md](../README.md), 구현과 검증은 [소스 안내](../src/AGENTS.md)와
[테스트 안내](../test/AGENTS.md)를 따른다.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
