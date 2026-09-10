<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/scripts

## 목적

전체 검증 게이트 `scripts/check.sh`의 엄격한 셸 설정, 임시 DB 정리, 환경 변수 처리,
검사 실행 순서를 소스 문자열로 확인한다.

## 주요 파일

| 파일                   | 설명                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `check-script.spec.ts` | Bash 스크립트를 읽어 실패 처리, EXIT 정리, 기존 DB URL 존중, 임의 포트 및 다섯 검사 순서를 단언한다. |

## AI 에이전트 지침

### 작업 시 주의사항

- `down -v` 검사는 `cleanup()` 본문 안으로 한정한다. 파일 어디에나 해당 문자열이
  있다는 것만 확인하면 실제 종료 정리 계약을 놓친다.
- 본문 추출기는 `cleanup() {`와 줄 시작의 닫는 중괄호를 기준으로 동작한다.
  셸 함수 형식을 바꾸면 파서도 함께 검토한다.
- 검사 순서는 ESLint → Prettier → TypeScript → 커버리지가 있는 Jest → secretlint다.
  스크립트를 수정할 때 이 순서와 실패 시 중단을 유지한다.
- 기존 `TEST_DATABASE_URL` 존중과 `TEST_DB_PORT=0`을 통한 포트 할당을 검사한다.
  이 테스트는 실제 데이터베이스 연결을 시도하지 않는다.

### 테스트 요구사항

저장소 루트에서 다음 명령을 실행한다.

```bash
pnpm test:quick --runInBand --runTestsByPath test/scripts/check-script.spec.ts
```

테스트 코드를 수정했다면 `pnpm typecheck`도 실행한다. 이 정적 검사는 Bash나 Docker를
실행하지 않으므로 Windows에서도 해당 도구 없이 실행할 수 있다. 실제 `check.sh` 실행에는
Bash가 필요하고, `TEST_DATABASE_URL`을 주지 않으면 Docker로 임시 PostgreSQL을 띄운다.

### 공통 패턴

- `import.meta.url` 기준으로 대상 스크립트 경로를 계산하고 UTF-8로 읽는다.
- 함수 내부 동작은 본문 범위를 추출해 단언한다.
- 각 검사 명령이 존재하는지 확인한 뒤 출현 위치를 정렬된 위치 배열과 비교한다.

## 의존성

### 내부

`scripts/check.sh`에 의존한다. 공통 테스트 실행 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

### 외부

Jest와 Node의 `fs`, `url` 모듈을 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
