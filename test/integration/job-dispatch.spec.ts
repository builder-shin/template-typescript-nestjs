import { randomBytes } from 'node:crypto';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { RefreshSession } from '../../src/app/models/refresh-session.entity.js';
import { User } from '../../src/app/models/user.entity.js';
import { dispatchJob } from '../../src/app/jobs/dispatch.js';
import { JOB_NAMES } from '../../src/app/jobs/queue.js';
import { acquireCommitLock, createTestDataSource } from '../db/fixture.js';
import type { DataSource } from 'typeorm';

/**
 * `dispatchJob`(잡 이름 → 핸들러 분배)의 계약을 실제 PostgreSQL로 고정한다.
 *
 * `worker.ts`에서 이 함수를 뺀 이유: 그 파일은 무조건 실행되는 top-level 스크립트라
 * import하는 순간 실제 Redis/PostgreSQL에 붙는다 — 그 안에 분배 로직이 남아 있으면
 * "모르는 잡 이름은 던진다"는 계약에 테스트가 닿을 방법이 없다. `dispatchJob`은
 * `{ name, data }`만 있으면 되므로(진짜 bullmq `Job`은 이 모양을 구조적으로 만족한다)
 * Redis 없이 직접 호출해 고정할 수 있다.
 *
 * **두 이름이 실제로 다른 핸들러로 가는지를 서로 다른 방법으로 증명한다:**
 * - `processExample`은 성공해도 아무것도 쓰지 않는 잡이라(`process-example.ts`)
 *   행 상태로는 "이 핸들러가 정말 불렸는지"를 증명할 수 없다. 대신
 *   `Logger.overrideLogger`로 경고 로그를 가로챈다(`process-example.spec.ts`의
 *   `captureWarnings`와 같은 관용구) — 존재하지 않는 id를 줘서 나오는 경고 문구는
 *   `processExample`만 낼 수 있는 문구이므로, 그 문구가 찍힌다는 것 자체가 이
 *   핸들러가 실행됐다는 직접 증거다.
 * - `purgeExpiredRefreshSessions`는 반대로 행을 지운다는 것 자체가 증거가 된다 —
 *   만료된 `refresh_sessions` 행을 하나 커밋해 두고, 분배 후 그 행이 실제로
 *   사라졌는지를 본다.
 *
 * `purgeExpiredRefreshSessions`를 거치는 테스트만 `acquireCommitLock`을 잡는다 —
 * 이 잡은 테이블 전체를 대상으로 하므로(`purge-refresh-sessions.spec.ts`가 이미
 * 설명한 이유와 같다) 커밋된 행이 다른 동시 스위트와 부딪히면 안 된다.
 * `processExample` 분배 테스트는 로그만 보고 아무것도 커밋하지 않으므로 이 잠금이
 * 필요 없다.
 */

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('dispatchJob', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  /** `process-example.spec.ts`의 `captureWarnings`와 같은 관용구. */
  async function captureWarnings(run: () => Promise<void>): Promise<string[]> {
    const warnings: string[] = [];
    Logger.overrideLogger({
      log: () => undefined,
      warn: (message: unknown, ...params: unknown[]) => {
        warnings.push([message, ...params].map((part) => String(part)).join(' '));
      },
      debug: () => undefined,
      verbose: () => undefined,
      error: () => undefined,
    });
    try {
      await run();
    } finally {
      Logger.overrideLogger(new ConsoleLogger());
    }
    return warnings;
  }

  it('processExample 이름의 잡은 processExample 핸들러로 분배된다', async () => {
    // MISSING_ID는 uuid 모양은 맞지만 존재하지 않는 Example이다 — processExample은
    // 이 경우 "찾을 수 없다"는 경고를 남기고 정상 종료한다(process-example.ts). 이
    // 경고 문구는 processExample만 낼 수 있으므로, 그 문구가 찍힌다는 것이 이
    // 핸들러가 실제로 불렸다는 증거다.
    const warnings = await captureWarnings(() =>
      dispatchJob(
        dataSource,
        { name: JOB_NAMES.processExample, data: { exampleId: MISSING_ID } },
        { refreshSessionRetentionSeconds: 0 },
      ),
    );
    expect(warnings.join('\n')).toContain(MISSING_ID);
  });

  it.each([null, undefined, false, 42, 'not-a-payload', [], {}])(
    'malformed process payload %j warns without querying the database or retrying',
    async (data) => {
      const manager = dataSource.manager;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Saved only to restore the same method, never invoked unbound.
      const originalFind = manager.findOneBy;
      manager.findOneBy = () => Promise.reject(new Error('Malformed payload reached the database'));
      try {
        const warnings = await captureWarnings(() =>
          dispatchJob(
            dataSource,
            { name: JOB_NAMES.processExample, data },
            { refreshSessionRetentionSeconds: 0 },
          ),
        );
        expect(warnings).toHaveLength(1);
      } finally {
        manager.findOneBy = originalFind;
      }
    },
  );

  it('purgeExpiredRefreshSessions 이름의 잡은 purgeExpiredRefreshSessions 핸들러로 분배된다', async () => {
    const commitLock = await acquireCommitLock(dataSource);
    const emailPrefix = 'job-dispatch-purge-';
    try {
      const user = await dataSource.manager.save(User, {
        email: `${emailPrefix}${String(Date.now())}@example.test`,
        passwordHash: 'x',
        isActive: true,
      });
      const session = await dataSource.manager.save(RefreshSession, {
        tokenHash: randomBytes(32).toString('hex'),
        userId: user.id,
        // 이미 만료됐고 보존 기간도 0으로 줄 것이므로 이 행은 대상이다.
        expiresAt: new Date(Date.now() - 60_000),
      });

      await dispatchJob(
        dataSource,
        { name: JOB_NAMES.purgeExpiredRefreshSessions, data: {} },
        { refreshSessionRetentionSeconds: 0 },
      );

      const found = await dataSource.manager.findOneBy(RefreshSession, { id: session.id });
      expect(found).toBeNull();
    } finally {
      try {
        await dataSource.query(`DELETE FROM users WHERE email LIKE '${emailPrefix}%'`);
      } finally {
        await commitLock.release();
      }
    }
  });

  it('모르는 잡 이름은 던진다 — 잘못 들어간 잡이 조용히 사라지지 않는다', async () => {
    await expect(
      dispatchJob(
        dataSource,
        { name: '있을-수-없는-잡-이름', data: {} },
        { refreshSessionRetentionSeconds: 0 },
      ),
    ).rejects.toThrow('있을-수-없는-잡-이름');
  });
});
