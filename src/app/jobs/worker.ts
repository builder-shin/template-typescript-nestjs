import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { brokerConnection, JOBS_QUEUE_NAME } from '../../config/broker.js';
import { buildDataSourceOptions } from '../../config/database.js';
import { loadDatabaseSettings, loadWorkerSettings } from '../../config/settings.js';
import { dispatchJob } from './dispatch.js';
import type { Job } from 'bullmq';

/**
 * 독립 워커 진입점 (스펙 3장 `src/app/jobs/worker.ts`).
 *
 * **Nest 애플리케이션 컨텍스트를 만들지 않는다.** HTTP도 컨트롤러도 필요 없고,
 * `AppModule`을 부팅하면 API 전용 설정 요구(`JWT_SECRET_KEY` 등)까지 워커가 떠안는다.
 * `src/config/data-source.ts`가 이미 보여 주는 방식대로 `DataSource`만 직접 만든다.
 *
 * **잡 이름 → 핸들러 분배 로직은 `dispatch.ts`에 있다, 여기 없다.** 그 함수가
 * 테스트 가능해야 "모르는 잡 이름은 던진다"는 계약을 실제로 붙잡을 수 있는데, 이
 * 파일은 아래 이유로 테스트가 import할 수 없기 때문이다. 이 파일은 설정을 읽고
 * `DataSource`·`Worker`를 만들어 `dispatchJob`을 배선하는 것만 한다.
 *
 * **`main.ts`와 같은 모양이다** — 무조건 실행되는 top-level 스크립트이고, 어떤
 * 테스트도 이 파일을 import하지 않는다(import하는 순간 실제 `REDIS_URL`/
 * `DATABASE_URL`을 읽고 커넥션을 맺고 `SIGTERM`/`SIGINT`를 등록해 버린다 — 테스트가
 * 통제할 수 없는 부수 효과다). 그래서 `main.ts`와 같은 이유로 `jest.config.js`의
 * `collectCoverageFrom`에서 실제로 제외돼 있다(`!src/app/jobs/worker.ts`) — 이
 * 파일 자체는 커버리지에 안 잡히고, 여기가 배선하는 계약들은 각자의 자리에서
 * 고정된다: 분배·"모르는 이름은 던진다"는 `test/integration/job-dispatch.spec.ts`,
 * 잡 옵션·실제 처리·재시도 횟수는 `test/integration/jobs-queue.spec.ts`가 bullmq
 * API를 직접 써서 고정한다.
 */

const logger = new Logger('worker');

async function bootstrap(): Promise<void> {
  const workerSettings = loadWorkerSettings();
  const databaseSettings = loadDatabaseSettings();

  const dataSource = new DataSource(buildDataSourceOptions(databaseSettings));
  await dataSource.initialize();

  const worker = new Worker(
    JOBS_QUEUE_NAME,
    (job: Job): Promise<void> => dispatchJob(dataSource, job, workerSettings),
    { connection: brokerConnection(workerSettings.redisUrl) },
  );

  /**
   * graceful shutdown은 실측된 세 줄이다 — `worker.close()`가 이미 "진행 중인 잡이
   * 끝날 때까지 대기"를 구현한다(프로브: 1.5초짜리 잡 중간(300ms)에 `close()`를 불러
   * 남은 1200ms를 정확히 기다린 뒤 반환). `{ url }`로 연결을 넘겼으므로(`brokerConnection`)
   * 커넥션은 BullMQ가 소유한다 — 따로 닫을 대상이 없다.
   *
   * **강제 종료 타임아웃을 두지 않는다(의도적 판단, 빠뜨린 것이 아니다).** 아주 긴
   * 잡이 `SIGTERM` 뒤에도 끝나지 않으면 이 핸들러는 무한정 기다린다는 한계가 있다.
   * 그런데도 넣지 않은 이유:
   * 1) 이 워커가 다루는 두 핸들러는 이미 자기 자신을 시간적으로 제한한다.
   *    `purgeExpiredRefreshSessions`는 배치마다 `lockTimeoutMs`로 잠금 대기를 자르고
   *    `MAX_BATCHES`로 배치 수 자체를 상한 두며(`purge-expired-refresh-sessions.ts`),
   *    `processExample`은 단순한 단건 조회 하나뿐이다 — "영원히 안 끝나는 잡"은 이미
   *    설계상 일어나기 어렵다.
   * 2) 강제 타임아웃 값 자체를 정당화할 근거가 스펙에 없다. 짧게 잡으면 정상적으로
   *    오래 걸리는 대량 정리 배치를 중간에 끊어 "진행 중인 잡을 기다린다"는
   *    `worker.close()`의 계약과 정면으로 부딪히고, 길게 잡으면 안전장치로서
   *    의미가 없다 — 둘 다 근거 없는 숫자를 하나 더 만드는 것이다.
   * 3) 컨테이너·오케스트레이터(Docker/Kubernetes 등)는 어차피 자기 자신의 유예
   *    시간이 지나면 `SIGKILL`로 강제 종료한다 — 그 유예 시간은 배포 환경이 상황에
   *    맞게 정하는 값이고(`docker stop -t`, `terminationGracePeriodSeconds`), 이
   *    프로세스 안에 또 다른(환경마다 다시 튜닝할 수도 없는) 숫자를 박아 넣는 것보다
   *    낫다.
   * 이 한계가 실제로 문제가 되는 배포 환경(강제 종료 백스톱이 없는 환경)이 생기면,
   * 그때는 그 환경이 요구하는 구체적인 시간을 근거로 다시 판단해야 한다.
   */
  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      // 같은 신호가 중복으로 오거나 SIGTERM·SIGINT가 겹쳐 와도 close()/destroy()를
      // 두 번 부르지 않는다.
      return;
    }
    shuttingDown = true;
    logger.log(`${signal} 수신 — 진행 중인 잡을 기다린 뒤 종료한다`);
    try {
      await worker.close();
      await dataSource.destroy();
      process.exit(0);
    } catch (error: unknown) {
      logger.error(
        '종료 절차 중 오류가 발생했다',
        error instanceof Error ? error.stack : String(error),
      );
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

await bootstrap();
