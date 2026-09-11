import { Backoffs, Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  createJobsQueue,
  enqueueProcessExample,
  JOB_WORKER_SETTINGS,
} from '../../src/app/jobs/queue.js';
import { brokerConnection } from '../../src/config/broker.js';
import { requireTestRedisUrl } from '../db/fixture.js';

describe('shared retry deadlines', () => {
  it('the actual worker persists the shared backoff after a failed attempt', async () => {
    const name = `shared-retry-${randomUUID()}`;
    const connection = brokerConnection(requireTestRedisUrl());
    const queue = new Queue(name, { connection });
    const worker = new Worker(name, () => Promise.reject(new Error('database unavailable')), {
      connection,
      settings: JOB_WORKER_SETTINGS,
    });
    try {
      const failed = once(worker, 'failed');
      const job = await enqueueProcessExample(queue, {
        exampleId: '00000000-0000-0000-0000-000000000000',
      });
      await failed;
      if (job.id === undefined) throw new Error('Missing job id');
      const scheduled = await queue.getJob(job.id);
      expect(await scheduled?.getState()).toBe('delayed');
      expect(scheduled?.attemptsMade).toBe(1);
      expect(scheduled?.failedReason).toBe('database unavailable');
      expect(scheduled?.delay).toBeGreaterThanOrEqual(15000);
      expect(scheduled?.delay).toBeLessThanOrEqual(24000);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it.each([0, 0.999999])('uses the shared delay distribution at random=%s', async (random) => {
    const queue = createJobsQueue(brokerConnection(requireTestRedisUrl()));
    const job = await enqueueProcessExample(queue, {
      exampleId: '00000000-0000-0000-0000-000000000000',
    });
    const originalRandom = Math.random;
    Math.random = () => random;
    try {
      const backoff = job.opts.backoff;
      if (backoff === undefined || typeof backoff === 'number')
        throw new Error('Missing backoff options');
      const delays = await Promise.all(
        [1, 2, 3].map((attempt) =>
          Promise.resolve(
            Backoffs.calculate(
              backoff,
              attempt,
              new Error('database unavailable'),
              job,
              JOB_WORKER_SETTINGS.backoffStrategy,
            ),
          ),
        ),
      );
      expect(delays).toEqual(random === 0 ? [15000, 30000, 60000] : [24000, 49000, 89000]);
      expect(job.opts.attempts).toBe(4);
    } finally {
      Math.random = originalRandom;
      await job.remove();
      await queue.close();
    }
  });
});
