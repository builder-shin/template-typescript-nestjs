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
 * DB 이름이 `_test`로 끝나야 한다. 이 fixture는 `TRUNCATE`를 실행하므로, 변수를
 * 실수로 개발 DB나 운영 DB로 두면 데이터가 사라진다. 접미사 검사는 그 사고를 막는
 * 값싼 방벽이다 — 편의를 위해 우회로를 만들지 않는다.
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

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL database name must end with "_test" (received "${databaseName}")`,
    );
  }

  return url;
}

/** 마이그레이션 구간을 직렬화하는 advisory lock 키. 이 저장소 안에서만 의미가 있다. */
const MIGRATION_LOCK_KEY = 4_182_026_829;

/**
 * 마이그레이션을 head까지 적용한 `DataSource`를 만든다.
 *
 * `runMigrations()`를 매번 호출한다. TypeORM이 `migrations` 테이블을 보고 이미
 * 적용된 것을 건너뛰므로 두 번째부터는 조회 한 번이다. Jest `globalSetup`으로 한 번만
 * 돌리는 방법도 있으나, ESM + ts-jest에서 `globalSetup`은 별도 모듈 로더를 타서
 * 실패 모드가 늘어난다. 조회 한 번의 비용으로 그 복잡도를 사지 않는다.
 *
 * `runMigrations()` 구간을 advisory lock으로 감싼다. Jest는 테스트 파일을 병렬 워커로
 * 돌리고 모든 워커가 같은 `TEST_DATABASE_URL`을 공유하는데, 마이그레이션의
 * `CREATE EXTENSION/TYPE/TABLE IF NOT EXISTS`는 동시 실행에 원자적이지 않다 — 두 워커가
 * 동시에 "없음"을 보고 둘 다 만들면 `pg_extension_name_index` 같은 시스템 카탈로그의
 * unique 제약이 터진다. lock/unlock은 반드시 같은 세션에서 실행해야 하므로 전용
 * `queryRunner`로 커넥션을 고정한다 — `dataSource.query()`는 호출마다 풀에서 다른
 * 커넥션을 받을 수 있어, lock과 unlock이 서로 다른 세션에 걸리면 unlock이 빗나가고
 * lock은 그 커넥션이 풀에 반납될 때까지 풀린 적 없는 상태로 남는다.
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

  const lockRunner = dataSource.createQueryRunner();
  await lockRunner.connect();
  try {
    await lockRunner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await dataSource.runMigrations();
  } finally {
    await lockRunner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    await lockRunner.release();
  }

  return dataSource;
}

/**
 * 콜백을 트랜잭션 안에서 실행하고 **항상** 롤백한다.
 *
 * 테스트끼리 상태를 남기지 않는 기본 격리 수단이다. 콜백이 성공해도 커밋하지 않으므로,
 * commit 이후를 관찰해야 하는 테스트(동시성, `ON CONFLICT` 경합)는 이 함수를 쓰지 않고
 * `truncateAll`로 정리한다.
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

/**
 * 모든 테이블을 비운다.
 *
 * commit을 관찰하는 테스트의 정리 수단이다. `migrations` 테이블은 남긴다 — 지우면
 * 다음 `createTestDataSource()`가 마이그레이션을 처음부터 다시 돌린다.
 */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas.map((metadata) => `"${metadata.tableName}"`);
  if (tables.length === 0) {
    return;
  }
  await dataSource.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
