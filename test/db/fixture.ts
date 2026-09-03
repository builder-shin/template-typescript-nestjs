import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { buildDataSourceOptions } from '../../src/config/database.js';

/**
 * 실제 PostgreSQL 테스트 fixture.
 *
 * 인메모리 SQLite나 모델 mock을 쓰지 않는다. 마이그레이션·관계·제약·upsert 계약은
 * 실제 엔진에서만 검증되고, 대체물로 통과시킨 테스트는 배포 시점에 무너진다.
 */

/**
 * `TEST_DATABASE_URL`을 읽고 안전 조건을 확인한다.
 *
 * DB 이름이 `_test`로 끝나야 하고, 경로 세그먼트가 정확히 하나여야 한다. **이 fixture는
 * 더 이상 `TRUNCATE`를 실행하지 않는다** — 예전에는 `truncateAll`이 있었지만 다른
 * 커밋 스위트의 행까지 지우는 사고 때문에 제거됐다(`withRollback` docstring 참고).
 * 그래도 변수를 실수로 개발 DB나 운영 DB로 두면 위험한 것은 마찬가지다 — 지금 이
 * fixture가 실제로 하는 파괴적 행위는 둘이다. (1) `createTestDataSource`가 테스트
 * 실행마다 무조건 `dataSource.runMigrations()`를 부른다(아래 참고) — 개발 DB를
 * 가리키면 그 DB의 스키마가 이 저장소의 마이그레이션 히스토리에 맞춰 그대로
 * 갈아엎인다. (2) `purgeExpiredRefreshSessions` 통합 스펙
 * (`test/integration/purge-refresh-sessions*.spec.ts`)이 부르는
 * `DELETE FROM refresh_sessions WHERE expires_at < $1`은 테스트가 만든 행으로
 * 좁혀지지 않는다 — 그 DB의 진짜 만료 세션도 그대로 지운다. 세그먼트가 여럿이면(예:
 * `/production/app_test`) 접미사 검사만으로는 걸러지지 않으므로 두 조건을 함께 본다 —
 * 이 검사들은 그 사고를 막는 값싼 방벽이다. 편의를 위해 우회로를 만들지 않는다.
 */
export function requireTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TEST_DATABASE_URL;
  if (raw === undefined || raw.trim() === '') {
    throw new Error('TEST_DATABASE_URL is required');
  }

  const url = raw.trim();
  let databaseName: string;
  try {
    // 끝 슬래시를 먼저 떼어낸다. `.../app_test/`가 `app_test/`로 읽혀 정당한 URL이
    // 거부되는 것을 막는다.
    databaseName = new URL(url).pathname.replace(/^\//, '').replace(/\/$/, '');
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid connection URL');
  }

  // Postgres 연결 URL의 경로 세그먼트는 하나뿐이다 — `/production/app_test`처럼 슬래시가
  // 남아 있으면 `endsWith('_test')`가 경로 구조를 보지 않고 그대로 통과시켜 버린다.
  // 세그먼트가 둘 이상이면 이 URL이 가리키는 게 우리가 생각하는 그 DB가 아니라는
  // 뜻이므로, 접미사를 보기 전에 먼저 거부한다.
  if (databaseName.includes('/')) {
    throw new Error(
      `TEST_DATABASE_URL must have exactly one path segment (received "${databaseName}")`,
    );
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL database name must end with "_test" (received "${databaseName}")`,
    );
  }

  return url;
}

/**
 * `TEST_REDIS_URL`을 읽는다.
 *
 * `requireTestDatabaseUrl`과 달리 이름 규칙으로 안전을 확인할 방법이 없다. Postgres는
 * DB 이름에 `_test` 접미사를 강제해 개발/운영 DB를 가리키는 실수를 값싸게 잡아내지만,
 * Redis 연결 URL은 호스트·포트(선택적으로 0-15 사이의 DB 인덱스)만 담을 뿐이고 그중
 * 무엇도 "이것은 테스트 전용"이라는 뜻을 신뢰성 있게 담지 않는다 — 포트 번호나 DB
 * 인덱스로 짐작하는 규칙을 만들 수는 있지만, 개발 환경이 우연히 같은 값을 쓰면 그
 * 규칙은 조용히 뚫린다. 그래서 이 함수가 확인하는 것은 값이 있고 URL 형식이라는
 * 것뿐이다 — **가리키는 Redis가 실제로 테스트 전용인지는 검증하지 못한다.** 이
 * 변수를 실수로 개발 Redis로 두면 그 키를 지우거나 덮어쓸 수 있는데, 그것을 막을
 * 이름 규칙이 없다는 사실 자체를 여기 기록해 둔다 — 값을 설정하는 사람이 직접
 * 책임져야 한다.
 */
export function requireTestRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TEST_REDIS_URL;
  if (raw === undefined || raw.trim() === '') {
    throw new Error('TEST_REDIS_URL is required');
  }

  const url = raw.trim();
  try {
    new URL(url);
  } catch {
    throw new Error('TEST_REDIS_URL must be a valid connection URL');
  }

  return url;
}

/** 마이그레이션 구간을 직렬화하는 advisory lock 키. 이 저장소 안에서만 의미가 있다. */
const MIGRATION_LOCK_KEY = 4_182_026_829;

/**
 * 스키마를 만드는 구간을 워커 사이에서 직렬화한다.
 *
 * Jest는 테스트 파일을 병렬 워커로 돌리고 모든 워커가 같은 `TEST_DATABASE_URL`을
 * 공유하는데, 마이그레이션의 `CREATE EXTENSION/TYPE/TABLE IF NOT EXISTS`는 동시 실행에
 * 원자적이지 않다 — 두 워커가 동시에 "없음"을 보고 둘 다 만들면
 * `pg_extension_name_index` 같은 시스템 카탈로그의 unique 제약이 터진다.
 *
 * lock/unlock은 반드시 같은 세션에서 실행해야 하므로 전용 `queryRunner`로 커넥션을
 * 고정한다 — `dataSource.query()`는 호출마다 풀에서 다른 커넥션을 받을 수 있어, lock과
 * unlock이 서로 다른 세션에 걸리면 unlock이 빗나가고 lock은 그 커넥션이 풀에 반납될
 * 때까지 풀린 적 없는 상태로 남는다.
 *
 * `fn`은 이 잠금과 다른 커넥션에서 실행돼도 된다. advisory lock은 세션이 아니라
 * 데이터베이스 단위로 보이므로, 잠금을 쥔 세션이 살아 있는 동안 다른 워커가 막힌다.
 */
export async function withMigrationLock<T>(
  dataSource: DataSource,
  fn: () => Promise<T>,
): Promise<T> {
  const lockRunner = dataSource.createQueryRunner();
  await lockRunner.connect();
  try {
    await lockRunner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    return await fn();
  } finally {
    try {
      await lockRunner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } finally {
      // unlock이 던져도 커넥션은 반드시 돌려준다. `withRollback`과 같은 이유다 —
      // 여기서 새면 풀이 마른다. 커넥션이 닫히면 advisory lock은 서버가 알아서 푼다.
      await lockRunner.release();
    }
  }
}

/** `examples`/`categories`/`tags`에 실제로 커밋하는 스위트끼리를 직렬화하는 잠금 키. */
const COMMIT_LOCK_KEY = 4_182_026_830;

/** `acquireCommitLock`이 돌려주는 해제 손잡이. */
export interface CommitLockHandle {
  release(): Promise<void>;
}

/**
 * 실제로 행을 커밋하는 통합 스위트끼리(`examples-api.spec.ts`, `examples-put.spec.ts`)
 * 상호 배제한다.
 *
 * 이 저장소의 통합 스펙 대부분은 `withRollback`으로 격리된다 — 커밋하지 않으므로
 * 서로에게 보이지 않고, Jest가 파일을 병렬 워커로 돌려도 안전하다. 그런데 실제 HTTP
 * 왕복과 커밋을 증명해야 하는 소수의 스위트(예: 생성 직후 `Location`을 확인하거나,
 * 동일 id 동시 요청의 advisory 잠금을 증명하는 테스트)는 `withRollback`을 쓸 수 없다.
 * 이 스위트들이 같은 공유 테이블에 동시에 행을 남기면, 한쪽이 정리하기 전에 다른 쪽의
 * "테이블 전체" 단언(빈 컬렉션, 총 개수 등)이 그 행을 함께 세어 버린다 — 각자 자기
 * id만 정리해도 막을 수 없는 종류의 간섭이다. `describe` 블록 전체를 이 잠금으로 감싸면
 * 그런 스위트끼리만 직렬화되고, 나머지 대다수의 `withRollback` 기반 스위트는 계속
 * 완전히 병렬로 돈다.
 *
 * `beforeAll`/`afterAll`에 걸쳐 잠금을 들고 있어야 하므로 `withMigrationLock`처럼 콜백을
 * 감싸는 모양이 아니라 acquire/release 손잡이로 준다 — `describe` 블록은 동기 함수라
 * 그 안의 모든 `it`을 비동기 콜백 하나로 감쌀 자리가 없다. 세션을 전용 `queryRunner`로
 * 고정하는 이유와 잠금 스코프를 세션(트랜잭션이 아니라)으로 고르는 이유는
 * `withMigrationLock`과 같다 — 이 잠금은 트랜잭션 하나가 아니라 스위트 전체에 걸린다.
 */
export async function acquireCommitLock(dataSource: DataSource): Promise<CommitLockHandle> {
  const lockRunner = dataSource.createQueryRunner();
  await lockRunner.connect();
  await lockRunner.query('SELECT pg_advisory_lock($1)', [COMMIT_LOCK_KEY]);
  return {
    async release(): Promise<void> {
      try {
        await lockRunner.query('SELECT pg_advisory_unlock($1)', [COMMIT_LOCK_KEY]);
      } finally {
        await lockRunner.release();
      }
    },
  };
}

/**
 * 주어진 `DataSource`로 스키마를 head까지 올린다.
 *
 * `runMigrations()`를 매번 호출한다. TypeORM이 `migrations` 테이블을 보고 이미
 * 적용된 것을 건너뛰므로 두 번째부터는 조회 한 번이다. Jest `globalSetup`으로 한 번만
 * 돌리는 방법도 있으나, ESM + ts-jest에서 `globalSetup`은 별도 모듈 로더를 타서
 * 실패 모드가 늘어난다. 조회 한 번의 비용으로 그 복잡도를 사지 않는다.
 */
async function migrateToHead(dataSource: DataSource): Promise<void> {
  await withMigrationLock(dataSource, async () => {
    await dataSource.runMigrations();
  });
}

/**
 * 테스트 데이터베이스의 스키마가 head까지 올라와 있게 만든다.
 *
 * **어떤 스위트도 다른 스위트가 스키마를 만들어 주기를 기다리지 않게 하는 것이 이
 * 함수의 존재 이유다.** `createTestDataSource`를 쓰는 스위트는 자기 `DataSource`로
 * 마이그레이션을 겸하지만, HTTP 통합 스위트는 `createTestApp`이 조립한 애플리케이션의
 * `DataSource`만 쓰고 그쪽은 `migrationsRun: false`다(운영과 같은 설정이며, 그래야
 * 하는 것이 맞다 — 마이그레이션은 배포 단계가 돌린다). 그 결과 한동안 이 스위트들은
 * 같은 실행 안의 **다른 워커**가 마이그레이션을 끝내 준 덕분에 우연히 통과하고
 * 있었다. Jest가 파일을 병렬 워커로 돌리므로 그 순서는 아무것도 보장하지 않는다 —
 * 빈 DB에서 통합 스위트가 먼저 출발하면 `relation "users" does not exist`로 무너진다
 * (실측: 빈 DB에 `jest test/integration/examples-api.spec.ts` 단독 실행 → 40개 전부
 * 실패. CI에서 실제로 터진 방식이기도 하다).
 *
 * 애플리케이션 조립 **전에** 부른다. 조립 뒤에 부르면 모듈 초기화 훅이 스키마를 먼저
 * 건드릴 여지가 남고, 무엇보다 "앱이 뜨면 스키마는 이미 준비돼 있다"는 단순한 계약이
 * 깨진다.
 *
 * 애플리케이션과 별개의 `DataSource`를 잠깐 열었다 닫는다. 앱의 풀을 빌리면 커넥션
 * 하나를 아끼지만, 그 대신 이 함수가 "앱이 `DataSource`를 노출한다"에 의존하게 된다 —
 * 스키마 준비는 앱보다 먼저 있어야 하는 일이므로 앱을 몰라야 한다.
 */
export async function ensureMigrated(): Promise<void> {
  const dataSource = new DataSource(
    buildDataSourceOptions({
      url: requireTestDatabaseUrl(),
      // 이 구간이 동시에 쓰는 커넥션은 둘뿐이다 — `withMigrationLock`의 전용 잠금
      // 커넥션과 `runMigrations()`가 쓰는 커넥션.
      poolMax: 2,
      idleTimeoutMs: 10000,
      connectionTimeoutMs: 10000,
    }),
  );
  await dataSource.initialize();
  try {
    await migrateToHead(dataSource);
  } finally {
    // 마이그레이션이 던져도 풀은 반드시 닫는다. 여기서 새면 이 스위트가 끝나도
    // 커넥션이 남아 다른 워커가 굶는다 — `withRollback`이 커넥션을 반드시 돌려주는
    // 것과 같은 원칙이다.
    await dataSource.destroy();
  }
}

/**
 * 마이그레이션을 head까지 적용한 `DataSource`를 만든다.
 *
 * `ensureMigrated`와 달리 만든 `DataSource`를 살려서 돌려준다 — 부르는 쪽이 그것으로
 * 질의하기 때문이다. 스키마를 올리는 방식(잠금·`runMigrations` 호출)은 둘이 똑같이
 * `migrateToHead`를 쓴다.
 */
export async function createTestDataSource(): Promise<DataSource> {
  const url = requireTestDatabaseUrl();
  const dataSource = new DataSource(
    buildDataSourceOptions({
      url,
      poolMax: 5,
      idleTimeoutMs: 10000,
      connectionTimeoutMs: 10000,
    }),
  );
  await dataSource.initialize();

  await migrateToHead(dataSource);

  return dataSource;
}

/**
 * 콜백을 트랜잭션 안에서 실행하고 **항상** 롤백한다.
 *
 * 테스트끼리 상태를 남기지 않는 기본 격리 수단이다. 콜백이 성공해도 커밋하지 않으므로,
 * commit 이후를 관찰해야 하는 테스트(`examples-put.spec.ts`의 동일 id 동시 요청,
 * `refresh-session-concurrency.spec.ts`의 동시 회전 등)는 이 함수를 쓰지 않고, 자기가
 * 만든 행만 id나 이메일 접두사로 좁혀 `afterEach`/`afterAll`에서 직접 지운다.
 *
 * 예전에는 이 자리에 `TRUNCATE TABLE ... RESTART IDENTITY CASCADE`로 한꺼번에 비우는
 * `truncateAll`이 있었다. 다른 스펙이 실제 HTTP로 행을 커밋하기 시작하면서 그 편의가
 * 위험이 됐다 — `TRUNCATE`는 워커 경계를 넘어 남의 커밋 행까지 지우고
 * `ACCESS EXCLUSIVE` 잠금으로 다른 워커의 읽기까지 막는다(Phase 4에서 겪은 사고,
 * `migrations.spec.ts`의 "스키마 제약" `describe`가 그 결정을 기록한다). 부르는 자리가
 * 하나도 남지 않아(`grep -rn "truncateAll(" test/ src/`로 확인) 지웠다 — 남겨 두면
 * 다음에 급하게 정리 수단을 찾는 사람이 이 함수를 다시 부르고 같은 사고를 반복한다.
 */
export async function withRollback<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    return await fn(queryRunner.manager);
  } finally {
    try {
      await queryRunner.rollbackTransaction();
    } catch {
      // 롤백 실패를 삼킨다. `fn`이 던진 오류가 진단의 근거인데, `finally`에서 새 오류가
      // 나가면 JS 의미상 그 원래 오류를 덮어버린다. 롤백 실패는 대개 원래 실패의 결과다.
    } finally {
      // 롤백이 어떻게 되든 커넥션은 반드시 돌려준다. 여기서 새면 풀이 마른다.
      await queryRunner.release();
    }
  }
}
