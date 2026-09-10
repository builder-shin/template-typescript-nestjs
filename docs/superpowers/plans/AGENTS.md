<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# plans

## 목적

설계 계약을 파일별 인터페이스, 구현 태스크와 검증 절차로 구체화한 계획을 보관한다.
Phase 0–8의 구현 과정과 이후 계약 통일 작업을 다룬다. 체크리스트와 예시 코드는 현재
구현 상태를 자동으로 증명하지 않으며, 기록을 읽는 것 자체가 계획 실행 요청은 아니다.

## 주요 파일

| 파일                                                                                           | 역할                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [2026-08-28-phase0-foundation.md](2026-08-28-phase0-foundation.md)                             | ESM 툴체인, 설정 로더, health·OpenAPI, 보안 검사·훅, Docker, 검증 게이트와 CI·README를 다루는 10개 태스크 및 후속 단계 인계 기록. |
| [2026-08-29-phase1-2-jsonapi-persistence.md](2026-08-29-phase1-2-jsonapi-persistence.md)       | JSON:API 문서·오류·협상·언어와 엔티티·마이그레이션·시드·실제 PostgreSQL fixture 구성.                                             |
| [2026-08-30-phase3-serializers-query-policy.md](2026-08-30-phase3-serializers-query-policy.md) | 시리얼라이저, 조회 allowlist, filter·sort·include 파서와 SQL 컴파일, offset·keyset 페이지네이션.                                  |
| [2026-08-30-phase4-crud-actions.md](2026-08-30-phase4-crud-actions.md)                         | 선언형 CrudActions, 쓰기 스키마 검증과 관계 라우트 조립, 실제 HTTP·PostgreSQL 계약 검증.                                          |
| [2026-08-30-phase5-put-upsert.md](2026-08-30-phase5-put-upsert.md)                             | PUT 생성·전체 교체, advisory 잠금과 같은 트랜잭션 안의 응답 재조회.                                                               |
| [2026-09-02-phase6-auth.md](2026-09-02-phase6-auth.md)                                         | argon2 비밀번호, JWT access·refresh, refresh session 회전과 Example 쓰기 인증.                                                    |
| [2026-09-02-phase7-jobs.md](2026-09-02-phase7-jobs.md)                                         | 독립 BullMQ 워커와 두 잡, Redis·PostgreSQL 검증 및 API의 broker 분리.                                                             |
| [2026-09-03-phase8-docs-ci.md](2026-09-03-phase8-docs-ci.md)                                   | Docker·Compose·CI 마감, 계층별 AGENTS.md 문서군과 문서 동기화 검사.                                                               |
| [2026-09-04-contract-parity.md](2026-09-04-contract-parity.md)                                 | 자원 타입·Example 스키마·조회 정책·페이지 크기 통일과 categories·tags 읽기 전용 라우트.                                           |

## 작업 지침

- 한국어 설명, 태스크 번호, 인터페이스, 코드 블록, 체크리스트와 선택 근거를 보존한다.
  문서 정리만으로 체크 항목을 완료 처리하거나 예시 명령을 실행하지 않는다.
- 현재 동작과 버전은 실제 소스와 루트 패키지 설정을 확인한다. 계획 머리말과 태스크
  예시에는 시점 차이가 있으므로 명령과 버전을 그대로 복사해 현재 사실로 단정하지 않는다.
- Phase 0의 인계 항목은 당시 후속 단계에 넘긴 일이다. 해당 기능의 현재 유무는 이후
  계획·룰링과 실제 소스를 함께 확인한다. 단계별 옛 완료 상태를 현재 저장소 상태와 구분한다.
- 검증용 비밀의 리터럴을 문서에 남기지 않는다. 계획에 기록된 것처럼 secretlint가
  문서 자체도 검사하므로 검증 예시는 비밀이 저장되지 않는 형태를 유지한다.
- `docs/`는 Prettier 제외 대상이다. 기존 기록의 무관한 재포맷을 피한다.

## 확인 방법

변경한 링크와 Markdown 구조를 확인하고, 계약 변경은 형제 설계 문서와 대조한다.
검사 명령과 기본 포맷 검사에서 제외되는 범위는 [문서 루트 안내](../../AGENTS.md)를 따른다.
`test/docs/agents.spec.ts`는 지정된 문서의 존재·경로와 검증 명령을 검사하지만 이 계획들의
내용이나 완료 여부를 판정하지 않는다.

## 의존 관계

- [전체 설계](../specs/2026-08-28-nestjs-jsonapi-template-design.md)가 Phase 계획들의 상위 계약이다.
- [계약 통일 설계](../specs/2026-09-04-contract-parity-design.md)가 계약 통일 계획의 범위를 정한다.
- [룰링 안내](../rulings/AGENTS.md)에서 Phase 3–8의 계획 수정·구현 편차와 판단 근거를 찾는다.
- [README.md](../../../README.md)의 `## 검증`, `scripts/check.sh`, CI와 Docker 설정은
  계획에 기록된 실행·검증 흐름과 관련된다. 현재 상태는 각 실제 파일을 기준으로 판단한다.
- `src/`와 `test/`가 계획의 구현·회귀 검증 대상이며, 실행 중 생성된 루트 `.superpowers/`
  기록은 이 디렉터리의 유지보수 문서와 구분한다.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
