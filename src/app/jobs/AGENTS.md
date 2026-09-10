<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/jobs

## 목적

하나의 BullMQ 큐에서 Example 처리와 만료 refresh session 정리를 수행합니다.
HTTP 서버와 별도인 워커를 제공하며 도메인 코드나 외부 cron이 명시적으로 enqueue합니다.

## 주요 파일

| 파일                                | 설명                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `queue.ts`                          | 잡 이름, 총 3회 시도·지수 backoff 옵션, 큐 생성과 enqueue 함수.                 |
| `dispatch.ts`                       | 잡 이름으로 핸들러를 선택하고 정리 배치 크기·잠금 대기 제한을 전달.             |
| `process-example.ts`                | Example을 조회하고 로그를 남기며 잘못된 ID·삭제된 행은 재시도 없이 종료.        |
| `purge-expired-refresh-sessions.ts` | 만료 세션을 MATERIALIZED CTE와 SKIP LOCKED로 배치 삭제하고 배치마다 커밋.       |
| `worker.ts`                         | 설정을 읽어 DataSource·Worker를 시작하고 오류 기록·종료 신호를 처리하는 진입점. |

## AI 에이전트 지침

- `worker.ts`는 import 즉시 실제 DB·Redis에 연결합니다. 단위 테스트나 다른 모듈에서
  import하지 말고 분배 로직은 `dispatch.ts`로 검증합니다.
- CRUD는 잡을 자동 등록하지 않습니다. `processExample`은 `updatedAt`을 포함해
  공개 필드를 변경하지 않습니다. 일시적 DB 오류는 던져 BullMQ 재시도를 받습니다.
- 생산자와 워커는 `JOB_NAMES`를 공유합니다. 재시도 횟수·backoff는 `queue.ts` 한 곳에서
  정하며 모르는 잡 이름은 실패시킵니다.
- 정리 함수는 배치마다 자체 트랜잭션을 열기 때문에 `DataSource`를 받습니다.
  `PURGE_BATCH_SQL`의 MATERIALIZED CTE는 배치 상한을 지키는 장치이므로 유지합니다.
- `SKIP LOCKED`는 cascade가 요구하는 잠금까지 피하지 못합니다. `lock_timeout`은
  잠금 대기 상한이며 실행 시간 상한이 아닙니다. 자기 참조 FK 인덱스도 함께 검토합니다.
- 종료 시 `worker.close()`로 진행 중인 잡을 기다린 뒤 DB를 닫습니다. 프로세스 내부의
  강제 종료 타이머는 없으며 배포 환경의 종료 유예 시간을 함께 고려합니다.

## 테스트

`pnpm typecheck` 후 PostgreSQL과 `TEST_DATABASE_URL`을 준비하여 저장소 루트에서 실행합니다.

```bash
pnpm test:quick --runInBand test/integration/process-example.spec.ts test/integration/purge-refresh-sessions.spec.ts test/integration/purge-refresh-sessions-contention.spec.ts test/integration/job-dispatch.spec.ts
```

큐 변경에는 테스트 전용 Redis와 `TEST_REDIS_URL`도 준비하고
`pnpm test:quick --runInBand test/integration/jobs-queue.spec.ts`를 실행합니다.
자기 잡만 정리하는 fixture 규칙은 [test/AGENTS.md](../../../test/AGENTS.md)를 따릅니다.
진입점 변경에는 `pnpm build`도 실행합니다.

## 의존성

`../../config/`의 DB·broker·worker 설정, `../models/`의 엔티티와 TypeORM,
BullMQ, Redis, Nest Logger를 사용합니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
