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
    databaseName = new URL(url).pathname.replace(/^\//, '');
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

/**
 * 마이그레이션을 head까지 적용한 `DataSource`를 만든다.
 *
 * `runMigrations()`를 매번 호출한다. TypeORM이 `migrations` 테이블을 보고 이미
 * 적용된 것을 건너뛰므로 두 번째부터는 조회 한 번이다. Jest `globalSetup`으로 한 번만
 * 돌리는 방법도 있으나, ESM + ts-jest에서 `globalSetup`은 별도 모듈 로더를 타서
 * 실패 모드가 늘어난다. 조회 한 번의 비용으로 그 복잡도를 사지 않는다.
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
  await dataSource.runMigrations();
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
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
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
