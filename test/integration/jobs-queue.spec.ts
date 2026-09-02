import { Queue, Worker } from 'bullmq';
import { Example } from '../../src/app/models/example.entity.js';
import { processExample } from '../../src/app/jobs/process-example.js';
import {
  JOB_ATTEMPTS,
  JOB_NAMES,
  createJobsQueue,
  enqueueProcessExample,
  enqueuePurgeExpiredRefreshSessions,
} from '../../src/app/jobs/queue.js';
import { brokerConnection, JOBS_QUEUE_NAME } from '../../src/config/broker.js';
import { acquireCommitLock, createTestDataSource, requireTestRedisUrl } from '../db/fixture.js';
import type { Job } from 'bullmq';
import type { ProcessExamplePayload } from '../../src/app/jobs/process-example.js';
import type { DataSource } from 'typeorm';

/**
 * `queue.ts`와 워커 진입점(`worker.ts`)의 계약을 실제 Redis·PostgreSQL로 고정한다.
 *
 * **`worker.ts`를 import하지 않는다.** 그 파일은 `main.ts`와 같은 모양(무조건 실행되는
 * top-level 스크립트)이라 import하는 순간 실제 `REDIS_URL`/`DATABASE_URL`을 읽고
 * 커넥션을 맺고 `SIGTERM`/`SIGINT`를 등록해 버린다 — 테스트가 통제할 수 없는 부수
 * 효과다. 대신 이 스펙은 `redis-fixture.spec.ts`와 같은 원칙으로, bullmq API를 직접
 * 써서 "큐에 실은 잡이 실제로 그 모양대로 처리되는가"라는 관찰 가능한 계약만 고정한다.
 *
 * **큐 이름은 세 종류로 나뉜다.**
 * - 테스트 1(옵션 확인)과 2(실제 처리)는 `createJobsQueue`/`JOBS_QUEUE_NAME`이 가리키는
 *   진짜 프로덕션 큐(`'jobs'`)를 쓴다 — 이름이 상수로 고정돼 있어 스위트마다 접두사를
 *   줄 수 없다. 그래서 이 큐를 통째로 지우지 않고, 이 스위트가 넣은 잡만 정확히
 *   `job.remove()`로 되돌린다.
 * - 테스트 3(재시도 횟수 실측)은 프로덕션 핸들러와 무관한 별도 큐를 이 스위트 전용
 *   이름으로 새로 만든다 — 그래서 `afterAll`이 아니라 그 테스트 안에서
 *   `queue.obliterate({ force: true })`로 통째로 지워도 안전하다(다른 스위트·개발자의
 *   키를 건드리는 `FLUSHALL`과 다르다 — 이 이름은 이 실행에서만 존재한다).
 *
 * **`Example` 행을 커밋하는 테스트 2만 `acquireCommitLock`을 잡는다.** 이 저장소의
 * `examples-api.spec.ts`("빈 컬렉션도 data가 배열이다")처럼 `examples` 테이블 전체를
 * 단언하는 스위트가 있으므로, 짧게라도 커밋된 행이 그 창에 끼어들면 안 된다
 * (`test/db/fixture.ts`의 `acquireCommitLock` 문서 참고). 테스트 1·3은 Redis만
 * 건드리므로 이 잠금이 필요 없다.
 *
 * **완료를 기다리는 방법.** `Job.waitUntilFinished`는 별도 `QueueEvents`(추가 Redis
 * 커넥션)가 필요해 이 스펙의 범위에 비해 무겁다. 대신 워커의 `completed`/`failed`
 * 이벤트를 직접 듣되, 리스너를 **enqueue보다 먼저** 등록하고 `job.id`가 만들어진
 * 뒤에야 그 id로 걸러 `resolve`한다 — 그래야 "이벤트를 놓치는" 경합과 "다른 잡의
 * 이벤트로 오판하는" 경합을 둘 다 피한다.
 */

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/** 테스트 2·3에 공통으로 주는 Jest 타임아웃(ms). 로컬 Redis 왕복은 훨씬 빠르지만, CI
 * 부하를 감안해 기본값(5000ms)보다 넉넉히 잡는다 — `purge-refresh-sessions-contention
 * .spec.ts`의 `TEST_TIMEOUT_MS`와 같은 이유·같은 값이다. */
const TEST_TIMEOUT_MS = 10000;

describe('큐(queue.ts)와 워커 진입점의 통합 계약', () => {
  let dataSource: DataSource;
  let redisUrl: string;
  let queue: Queue;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    redisUrl = requireTestRedisUrl();
    queue = createJobsQueue(brokerConnection(redisUrl));
  });

  afterAll(async () => {
    try {
      await queue.close();
    } finally {
      await dataSource.destroy();
    }
  });

  it('enqueue한 잡이 attempts: 3으로 들어간다 — 스펙 10장의 재시도 계약이 큐에 실제로 실린다', async () => {
    const processJob = await enqueueProcessExample(queue, { exampleId: MISSING_ID });
    const purgeJob = await enqueuePurgeExpiredRefreshSessions(queue);
    try {
      // JOB_ATTEMPTS 자신이 스펙값(3)인지와, 두 enqueue 헬퍼가 실제로 그 값을 큐에
      // 실었는지를 함께 고정한다 — 상수가 바뀌어도 이 테스트는 여전히 "그 값이 실제로
      // 실린다"만 보증하므로, 스펙값 자체가 맞는지는 별도로 단언해 둔다.
      expect(JOB_ATTEMPTS).toBe(3);
      expect(processJob.opts.attempts).toBe(JOB_ATTEMPTS);
      expect(purgeJob.opts.attempts).toBe(JOB_ATTEMPTS);
    } finally {
      // 이 테스트는 워커를 띄우지 않으므로 두 잡 다 처리되지 않은 채 waiting 상태로
      // 남는다 — 진짜 프로덕션 큐에 흔적을 남기지 않도록 직접 지운다.
      await processJob.remove();
      await purgeJob.remove();
    }
  });

  it(
    '워커가 실제로 processExample 잡을 집어 처리한다 — 행은 한 글자도 바뀌지 않는다',
    async () => {
      const commitLock = await acquireCommitLock(dataSource);
      let worker: Worker | undefined;
      // try 밖(finally)에서도 정리에 써야 하므로 try 스코프 밖에 둔다.
      let createdId: string | undefined;
      try {
        const created = await dataSource.manager.save(Example, {
          title: '잡 큐 통합 테스트',
          status: 'draft',
        });
        createdId = created.id;
        const before = await dataSource.manager.findOneByOrFail(Example, { id: created.id });

        // `target`(바인딩 자체)은 재할당되지 않으므로 const다 — 실제로 바뀌는 것은
        // `target.jobId` 필드이고, 아래 completed/failed 리스너 클로저는 이 객체를
        // 참조로 캡처해 나중에 채워질 값을 읽는다.
        const target: { jobId?: string } = {};
        const finished = new Promise<void>((resolve, reject) => {
          worker = new Worker(
            JOBS_QUEUE_NAME,
            async (job: Job): Promise<void> => {
              if (job.name !== JOB_NAMES.processExample) {
                throw new Error(`이 테스트 워커는 ${job.name}을 다루지 않는다`);
              }
              await processExample(dataSource.manager, job.data as ProcessExamplePayload);
            },
            { connection: brokerConnection(redisUrl) },
          );
          worker.on('completed', (finishedJob) => {
            if (finishedJob.id === target.jobId) {
              resolve();
            }
          });
          worker.on('failed', (finishedJob, error) => {
            if (finishedJob?.id === target.jobId) {
              reject(error);
            }
          });
        });

        // 리스너는 이미 등록됐고, 이 job은 지금 막 만들어지므로 그 이전에 완료 이벤트가
        // 왔을 수는 없다 — 그래서 id를 지금 알려줘도 놓치는 경합이 없다.
        const job = await enqueueProcessExample(queue, { exampleId: created.id });
        target.jobId = job.id;
        await finished;

        const after = await dataSource.manager.findOneByOrFail(Example, { id: created.id });
        expect(after).toEqual(before);

        await job.remove();
      } finally {
        try {
          await worker?.close();
        } finally {
          try {
            if (createdId !== undefined) {
              await dataSource.manager.delete(Example, { id: createdId });
            }
          } finally {
            await commitLock.release();
          }
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '던지는 프로세서는 attempts만큼(3회) 정확히 불린다 — "attempts: 3 = 총 세 번의 시도"를 실측으로 고정한다',
    async () => {
      // 이 테스트만을 위한 별도 큐다 — JOB_NAMES/processExample과 무관한, 이 실행에서만
      // 존재하는 이름을 써서 프로덕션 큐를 건드리지 않는다.
      const throwingQueueName = `jobs-queue-spec-throwing-${String(process.pid)}-${String(Date.now())}`;
      const throwingQueue = new Queue(throwingQueueName, {
        connection: brokerConnection(redisUrl),
      });
      let callCount = 0;
      const worker = new Worker(
        throwingQueueName,
        // 동기적으로 던지기만 하므로 async가 필요 없다 — bullmq는 이 호출을 자기
        // try/await 안에서 부르므로 동기 throw도 정상적으로 실패로 잡힌다. 반환 타입을
        // Promise<void>로 명시해도 되는 이유는 이 함수가 던지는 것 말고는 아무 코드
        // 경로도 없어서(return에 도달하지 않아) 타입 체커가 허용하기 때문이다.
        (): Promise<void> => {
          callCount += 1;
          throw new Error('의도된 실패 — 재시도 횟수를 실측하기 위한 프로세서다');
        },
        { connection: brokerConnection(redisUrl) },
      );
      try {
        // bullmq는 재시도로 이어지는 중간 실패에도 'failed'를 emit한다(재시도 종료
        // 여부와 무관하게 handleFailed가 매번 emit한다 — bullmq 6.3.4
        // classes/worker.js 직접 확인) — 그래서 완료가 아니라 "attempts번째 failed"를
        // 기다려야 재시도가 다 끝난 뒤의 callCount를 본다.
        let failedEventCount = 0;
        const exhausted = new Promise<void>((resolve) => {
          worker.on('failed', () => {
            failedEventCount += 1;
            if (failedEventCount >= JOB_ATTEMPTS) {
              resolve();
            }
          });
        });

        await throwingQueue.add(
          'throwing',
          {},
          // attempts는 JOB_ATTEMPTS를 그대로 써서 프로덕션과 같은 값임을 보장한다.
          // backoff만 이 테스트 전용으로 짧게 줘서(10ms) 재시도 대기로 테스트가
          // 느려지지 않게 한다 — 프로덕션 기본 backoff(queue.ts)와는 별개다.
          { attempts: JOB_ATTEMPTS, backoff: { type: 'fixed', delay: 10 } },
        );

        await exhausted;
        expect(callCount).toBe(JOB_ATTEMPTS);
      } finally {
        await worker.close();
        await throwingQueue.obliterate({ force: true });
        await throwingQueue.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
