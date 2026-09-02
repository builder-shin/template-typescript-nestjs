import { processExample } from './process-example.js';
import { purgeExpiredRefreshSessions } from './purge-expired-refresh-sessions.js';
import { JOB_NAMES } from './queue.js';
import type { ProcessExamplePayload } from './process-example.js';
import type { DataSource } from 'typeorm';

/**
 * 잡 이름 → 핸들러 분배 (스펙 10장이 잡 두 개를 하나의 큐 이름 아래 나누는 지점).
 *
 * `worker.ts`가 아니라 여기 있는 이유: `worker.ts`는 `main.ts`와 같은 모양(무조건
 * 실행되는 top-level 스크립트)이라 import하는 순간 실제 Redis/PostgreSQL에 붙는다 —
 * 분배 로직이 그 안에 있으면 "모르는 잡 이름은 던진다"는 계약에 테스트가 닿을 방법이
 * 없다. 이 함수는 `(DataSource, 잡 이름·데이터, 설정) → 핸들러 호출` 하나만 하므로
 * 진짜 bullmq `Job` 없이도 직접 부를 수 있다 — `worker.ts`는 이 함수를 배선만 한다.
 */

/**
 * `dispatchJob`이 받는 최소한의 잡 모양.
 *
 * 실제 bullmq `Job`은 이보다 훨씬 많은 필드·메서드를 갖지만, 분배에 필요한 것은
 * 이름과 데이터뿐이다. 진짜 `Job` 인스턴스는 구조적으로 이 타입을 만족하므로
 * `worker.ts`는 그대로 넘기면 되고, 테스트는 이 최소 모양의 리터럴로 직접 부를 수
 * 있다(bullmq/Redis가 전혀 필요 없다).
 */
export interface JobLike {
  readonly name: string;
  readonly data: unknown;
}

/** `dispatchJob`이 받는 설정. */
export interface DispatchOptions {
  readonly refreshSessionRetentionSeconds: number;
}

/**
 * `purgeExpiredRefreshSessions`에 넘기는 배치 크기.
 *
 * 스펙 12장의 환경 변수 표에 이 값을 위한 변수가 없다 — 새로 만들지 않고 이 파일의
 * 상수로 둔다(브리프 지시). `purge-expired-refresh-sessions.ts`의 `MAX_BATCHES`
 * 주석이 실제 운영 배치 크기로 "수백~수천"을 전제하므로 그 자릿수 안에서 고른다.
 * 너무 작으면(예: 1) 지운 행 수만큼 SQL 왕복이 늘어 비효율적이고, 너무 크면 배치 하나의
 * `DELETE`·cascade 잠금이 오래 걸려 다른 트랜잭션과 부딪힐 창이 넓어진다. 500은 그
 * 중간값이다.
 */
const PURGE_BATCH_SIZE = 500;

/**
 * `purgeExpiredRefreshSessions`에 넘기는 `lock_timeout`(ms).
 *
 * 프로브가 실측한 500ms를 그대로 쓴다(`purge-expired-refresh-sessions.ts`의
 * `purgeExpiredRefreshSessions` docstring 참고) — cascade 잠금 경합에서 55P03을
 * 유도하기에 충분히 짧으면서도, 정상적인 배치 하나가 끝나는 데 걸리는 시간보다는
 * 넉넉하다.
 */
const PURGE_LOCK_TIMEOUT_MS = 500;

/**
 * 잡 하나를 이름에 맞는 핸들러로 분배해 실행한다.
 *
 * 알려진 두 이름은 각자의 핸들러로 가고, 그 외에는 던진다 — 모르는 잡 이름을 조용히
 * 성공시키면 잘못 들어간 잡이 큐에서 사라지고 아무도 모른다.
 */
export async function dispatchJob(
  dataSource: DataSource,
  job: JobLike,
  options: DispatchOptions,
): Promise<void> {
  switch (job.name) {
    case JOB_NAMES.processExample:
      // 이 큐에 이 이름으로 들어오는 데이터는 오직 `enqueueProcessExample`이
      // 실은 것뿐이다(`queue.ts`) — 그 계약을 여기서 캐스트로 표현한다.
      await processExample(dataSource.manager, job.data as ProcessExamplePayload);
      return;
    case JOB_NAMES.purgeExpiredRefreshSessions:
      await purgeExpiredRefreshSessions(dataSource, {
        retentionSeconds: options.refreshSessionRetentionSeconds,
        batchSize: PURGE_BATCH_SIZE,
        lockTimeoutMs: PURGE_LOCK_TIMEOUT_MS,
      });
      return;
    default:
      // 모르는 잡 이름을 조용히 성공시키면 잘못 들어간 잡이 사라지고 아무도
      // 모른다 — 던져서 실패·재시도(그리고 결국 failed 목록)로 드러낸다.
      throw new Error(`알 수 없는 잡 이름이다: ${job.name}`);
  }
}
