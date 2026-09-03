import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { brokerConnection, JOBS_QUEUE_NAME } from '../../config/broker.js';
import { buildDataSourceOptions } from '../../config/database.js';
import { loadDatabaseSettings, loadWorkerSettings } from '../../config/settings.js';
import { dispatchJob } from './dispatch.js';
import type { Job } from 'bullmq';

/**
 * 독립 워커 진입점.
 *
 * 스펙 3장은 `src/app/jobs/`를 `# BullMQ 프로세서` 한 줄로만 정할 뿐 이 파일 이름까지
 * 정하지 않는다 — 생산자·워커·분배로 나누는 것은 Phase 7의 설계다(`queue.ts` 참고).
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
   * `error` 리스너가 없으면 Node가 `EventEmitter`의 "listener 없는 에러 이벤트는
   * 던진다" 기본 동작을 적용하는데, bullmq는 그 throw를 자기 안에서 잡아 조용히
   * `console.error`로만 남기고 넘어간다(실측, `bullmq` 소스의 `emit('error', ...)`
   * 호출부). 그러면 Redis 연결 장애 같은 신호가 이 파일이 나머지 로그 전부를 보내는
   * Nest `Logger`를 완전히 우회해 `console.error`로만 나가고, Compose의 `worker`
   * 서비스는 healthcheck를 꺼 뒀으므로(`docker-compose.yml`의 `worker.healthcheck.disable`
   * 주석 참고) 아무것도 이 상태를 알아채지 못한다. 이것은 관찰 가능성 문제이지
   * 안전성 문제가 아니다 — bullmq는 이 이벤트와 무관하게 스스로 재연결한다.
   */
  worker.on('error', (error: Error) => {
    logger.error('워커에서 처리되지 않은 오류가 발생했다', error.stack);
  });

  /**
   * graceful shutdown은 실측된 세 줄이다 — `worker.close()`가 이미 "진행 중인 잡이
   * 끝날 때까지 대기"를 구현한다(프로브: 1.5초짜리 잡 중간(300ms)에 `close()`를 불러
   * 남은 1200ms를 정확히 기다린 뒤 반환). `{ url }`로 연결을 넘겼으므로(`brokerConnection`)
   * 커넥션은 BullMQ가 소유한다 — 따로 닫을 대상이 없다.
   *
   * **강제 종료 타임아웃을 두지 않는다(의도적 판단, 빠뜨린 것이 아니다).** 아주 긴
   * 잡이 `SIGTERM` 뒤에도 끝나지 않으면 이 핸들러는 무한정 기다린다는 한계가 있다.
   *
   * **이 한계가 실제로 얼마나 좁은지부터 정확히 하자.** 이 워커가 다루는 두 핸들러 중
   * `processExample`은 단순한 단건 조회 하나뿐이라 원천적으로 오래 걸리지 않는다.
   * `purgeExpiredRefreshSessions`는 배치 **횟수**(`MAX_BATCHES`)와 잠금을 **기다리는**
   * 시간(`lockTimeoutMs`)에는 상한이 있지만, 그 둘은 시간 상한이 아니다 —
   * `lock_timeout`은 잠금을 얻기까지 기다리는 시간만 자를 뿐, 잠금을 얻은 뒤 문장이
   * 실제로 실행되는 시간은 재지 않는다(인덱스 없는 cascade가 배치 하나를 몇 분씩
   * 순차 스캔으로 돌게 만들 수 있었던 것과 같은 구분이다 — 지금은
   * `20260902164541-add-refresh-sessions-replaced-by-index.ts`로 그 경로가 걸릴
   * 가능성을 크게 줄였을 뿐, 없앴다거나 "상한을 둔다"고까지는 말할 수 없다 —
   * 이 워커가 "영원히 안 끝나는 잡"에서 구조적으로 완전히 자유롭다는 근거는 아니다).
   * 그래서 넣지 않은 진짜 이유는 이것이다:
   * 1) 강제 타임아웃 값 자체를 정당화할 근거가 스펙에 없다. 짧게 잡으면 정상적으로
   *    오래 걸리는 대량 정리 배치를 중간에 끊어 "진행 중인 잡을 기다린다"는
   *    `worker.close()`의 계약과 정면으로 부딪히고, 길게 잡으면 안전장치로서
   *    의미가 없다 — 둘 다 근거 없는 숫자를 하나 더 만드는 것이다.
   * 2) 컨테이너·오케스트레이터(Docker/Kubernetes 등)는 어차피 자기 자신의 유예
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
