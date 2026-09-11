import { processExample } from './process-example.js';
import { purgeExpiredRefreshSessions } from './purge-expired-refresh-sessions.js';
import { JOB_NAMES } from './queue.js';
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

/** Shared purge batch and lock wait settings. */
const PURGE_BATCH_SIZE = 1000;
const PURGE_LOCK_TIMEOUT_MS = 2000;

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
      // The handler validates serialized job data before accessing the database.
      await processExample(dataSource.manager, job.data);
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
