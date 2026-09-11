import { Queue } from 'bullmq';
import { JOBS_QUEUE_NAME } from '../../config/broker.js';
import type { ConnectionOptions, Job, JobsOptions, WorkerOptions } from 'bullmq';
import type { ProcessExamplePayload } from './process-example.js';

/**
 * 큐 정의와 enqueue 헬퍼.
 *
 * 스펙 3장은 `src/app/jobs/`를 `# BullMQ 프로세서` 한 줄로만 정한다 — 그 디렉터리
 * 안을 생산자(`queue.ts`)·워커(`worker.ts`)·분배(`dispatch.ts`)로 나누는 것은 스펙이
 * 아니라 Phase 7이 정한 설계다.
 *
 * 생산자(이 파일)와 워커(`worker.ts`)가 정확히 같은 잡 이름·같은 잡 옵션을 봐야 한다.
 * 그 계약이 어긋나면 잡이 조용히 영원히 처리되지 않거나(이름이 다르면) 재시도 횟수가
 * 문서와 달라지는데(옵션이 다르면) 둘 다 예외를 던지지 않는다 — 그래서 잡 이름과 잡
 * 옵션 모두 이 파일 하나에서만 정의하고, `worker.ts`는 이 파일의 `JOB_NAMES`를 그대로
 * 가져다 쓴다.
 */

/**
 * 이 큐가 다루는 잡 이름. 워커(`worker.ts`)가 이 이름으로 두 핸들러에 분배한다.
 *
 * 문자열 리터럴이 아니라 이 상수를 통해서만 이름을 주고받는다 — 오타 하나가 생산자와
 * 워커를 서로 다른 잡으로 갈라놓는데, 그 상태는 예외를 던지지 않고 그냥 잡이 처리되지
 * 않을 뿐이라 진단하기 어렵다.
 */
export const JOB_NAMES = {
  processExample: 'processExample',
  purgeExpiredRefreshSessions: 'purgeExpiredRefreshSessions',
} as const;

/** Initial attempt plus three retries, matching the shared worker contract. */
export const JOB_ATTEMPTS = 4;

/** Shared with Dramatiq/Sidekiq: exponential base plus integer-second jitter. */
export const JOB_WORKER_SETTINGS: NonNullable<WorkerOptions['settings']> = {
  backoffStrategy: (attemptsMade: number): number =>
    15000 * 2 ** (attemptsMade - 1) + Math.floor(Math.random() * 10 * attemptsMade) * 1000,
};

/** The three retry delays lie in 15..24, 30..49 and 60..89 seconds. */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'shared-exponential', delay: 15000 },
};

/**
 * BullMQ `Queue` 인스턴스를 만든다.
 *
 * `connection`은 `brokerConnection(redisUrl)`이 돌려주는 옵션을 그대로 받는다(인스턴스가
 * 아니다 — `src/config/broker.ts`의 docstring 참고). 그래야 이 큐를 닫을 때
 * `queue.close()` 하나로 충분하고, 별도로 관리해야 할 Redis 인스턴스가 생기지 않는다.
 */
export function createJobsQueue(connection: ConnectionOptions): Queue {
  return new Queue(JOBS_QUEUE_NAME, { connection });
}

/**
 * `processExample` 잡을 enqueue한다.
 */
export async function enqueueProcessExample(
  queue: Queue,
  payload: ProcessExamplePayload,
): Promise<Job> {
  return queue.add(JOB_NAMES.processExample, payload, DEFAULT_JOB_OPTIONS);
}

/**
 * `purgeExpiredRefreshSessions` 잡을 enqueue한다.
 *
 * 페이로드가 없다 — `batchSize`/`lockTimeoutMs`/`retentionSeconds`는 잡이 옮겨 다니는
 * 데이터가 아니라 워커가 자기 설정·상수에서 정하는 값이다(`worker.ts` 참고). 외부
 * cron이 "지금 정리를 돌려라"라는 신호만 준다(스펙 10장: "외부 cron이 enqueue만
 * 담당한다").
 */
export async function enqueuePurgeExpiredRefreshSessions(queue: Queue): Promise<Job> {
  return queue.add(JOB_NAMES.purgeExpiredRefreshSessions, {}, DEFAULT_JOB_OPTIONS);
}
