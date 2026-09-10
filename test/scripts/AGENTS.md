<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/scripts

## 목적

전체 검증 게이트와 npm script의 계약을 소스 문자열로 검사한다. Bash·Docker나
개별 검사 명령을 이 테스트가 직접 실행하는 것은 아니다.

## 주요 파일

| 파일                                         | 설명                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [check-script.spec.ts](check-script.spec.ts) | 엄격한 셸 모드, EXIT 정리, DB·Redis 각각의 외부 URL 존중·임의 포트, 다섯 검사 순서를 고정한다. |
| [npm-scripts.spec.ts](npm-scripts.spec.ts)   | 필수 script 이름, check의 셸 진입점, 나머지 명령의 특정 셸 의존 표기를 검사한다.               |

## AI 에이전트 지침

- 정리 검사는 cleanup 함수 안에서 down -v와 started_test_services를 확인한다.
  파일 어디에나 문자열만 있으면 통과하는 방식으로 넓히지 않는다.
- DB와 Redis는 TEST_DATABASE_URL·TEST_REDIS_URL 각각으로 독립 판단한다.
  한쪽 URL만 주어진 경우에도 다른 서비스의 임시 생성 계약을 유지한다.
- 실행 순서는 ESLint → Prettier → TypeScript → 커버리지 포함 Jest → secretlint다.
- npm script의 금지 문자열 검사는 Windows 호환성의 일부만 본다. POSIX 전용 실행
  파일이나 다른 셸 문법까지 보장하지 않으므로 실제 실행 성공과 구별한다.
- 스크립트 함수 형식이나 검증 명령을 바꾸면 본문 추출기와 문서의 정본도 함께 검토한다.

## 검증

저장소 루트에서 실행한다. 아래 정적 검사에는 외부 서비스나 Bash가 필요 없다.
실제 전체 게이트는 Bash가 필요하며, 전달되지 않은 서비스 URL은 Docker로 준비한다.

```bash
pnpm test:quick --runInBand test/scripts
pnpm typecheck
```

## 의존성

scripts/check.sh와 package.json을 UTF-8로 읽는다. Jest와 Node fs·url을 사용한다.
공통 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
