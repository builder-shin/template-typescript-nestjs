import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import { buildDataSourceOptions } from '../../src/config/database.js';
import { MIGRATIONS } from '../../src/db/migrations/index.js';
import { requireTestDatabaseUrl, withMigrationLock } from '../db/fixture.js';

/**
 * 마이그레이션 되돌리기.
 *
 * 스펙 11.1은 "되돌릴 수 없는 마이그레이션은 받지 않으므로 `down()`을 비워 두지 않는다"고
 * 정한다. `test/db/migration-naming.spec.ts`는 `down()`이 **존재하는지**만 보므로, 실제로
 * 되돌리는지는 여기서 실제 PostgreSQL에 걸어 본다 — 한 번도 실행된 적 없는 `down()`은
 * 배포 롤백이 필요한 그 순간에 처음 실행된다.
 *
 * **왜 전용 스키마에서 도는가**: Jest는 테스트 파일을 병렬 워커로 돌리고 모든 워커가 같은
 * `TEST_DATABASE_URL`을 공유한다. `public`에서 `DROP TABLE`을 하면 같은 순간 다른 워커가
 * 쓰고 있는 테이블을 지우게 된다. 그래서 전용 스키마를 만들고 `search_path`를 그쪽으로
 * 돌린 커넥션에서만 `up`/`down`을 실행한다 — 다른 워커의 `public`은 건드리지 않는다.
 *
 * `pgcrypto`만은 확장이라 데이터베이스 단위이고 스키마로 가둘 수 없다. 마이그레이션의
 * `CREATE EXTENSION IF NOT EXISTS`가 (1) 다른 워커와 경합하지 않고 (2) 전용 스키마에
 * 설치돼 정리 때 함께 사라지는 일이 없도록, 시작 전에 `public`에 확정적으로 만들어 둔다.
 * 그 한 줄만 다른 워커와 같은 advisory lock 아래에서 실행한다.
 */
const PROBE_SCHEMA = 'migration_revert_probe';

interface SchemaSnapshot {
  readonly tables: readonly string[];
  readonly enums: readonly string[];
  readonly indexes: readonly string[];
}

/**
 * `QueryRunner.query`가 아니라 `DataSource.query`를 쓴다.
 *
 * 전자는 제네릭 인자가 없어 `any`를 돌려주고, 그러면 `strictTypeChecked`의 `no-unsafe-*`가
 * 결과를 다루는 모든 줄에 걸린다. 후자는 세 번째 인자로 실행할 `QueryRunner`를 받으므로
 * 타입을 잃지 않으면서 `search_path`를 세팅해 둔 그 커넥션에서 실행된다.
 */
async function snapshot(source: DataSource, runner: QueryRunner): Promise<SchemaSnapshot> {
  const tables = await source.query<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [PROBE_SCHEMA],
    runner,
  );
  const enums = await source.query<{ typname: string }[]>(
    `SELECT typname FROM pg_type
     JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
     WHERE pg_namespace.nspname = $1 AND pg_type.typtype = 'e'
     ORDER BY typname`,
    [PROBE_SCHEMA],
    runner,
  );
  const indexes = await source.query<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
    [PROBE_SCHEMA],
    runner,
  );
  return {
    tables: tables.map((row) => row.table_name),
    enums: enums.map((row) => row.typname),
    indexes: indexes.map((row) => row.indexname),
  };
}

describe('마이그레이션 down', () => {
  // `beforeAll`이 중간에 실패해도 `afterAll`이 정리할 수 있어야 하므로 `undefined`를
  // 허용한다. 캐스트로 초기화를 가장하지 않는다.
  let dataSource: DataSource | undefined;
  let runner: QueryRunner | undefined;
  let afterUp: SchemaSnapshot;
  let afterDown: SchemaSnapshot;

  beforeAll(async () => {
    const source = new DataSource(
      buildDataSourceOptions({
        url: requireTestDatabaseUrl(),
        // 잠금 구간에서 커넥션 두 개(잠금 전용 + `dataSource.query`)를 동시에 쓴다.
        poolMax: 4,
        idleTimeoutMs: 10000,
        connectionTimeoutMs: 10000,
      }),
    );
    dataSource = source;
    await source.initialize();

    await withMigrationLock(source, async () => {
      await source.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public`);
    });

    const probe = source.createQueryRunner();
    runner = probe;
    await probe.connect();
    await probe.query(`DROP SCHEMA IF EXISTS "${PROBE_SCHEMA}" CASCADE`);
    await probe.query(`CREATE SCHEMA "${PROBE_SCHEMA}"`);
    // `public`을 뒤에 둬야 `gen_random_uuid()`(pgcrypto)가 해석된다. 새로 만드는 객체는
    // 앞에 있는 전용 스키마로 간다.
    await probe.query(`SET search_path TO "${PROBE_SCHEMA}", public`);

    const ordered = [...MIGRATIONS];
    for (const migration of ordered) {
      await new migration().up(probe);
    }
    afterUp = await snapshot(source, probe);

    // 되돌리기는 마지막 것부터다. 마이그레이션이 여럿이 되어도 이 순서가 유지된다.
    for (const migration of [...ordered].reverse()) {
      await new migration().down(probe);
    }
    afterDown = await snapshot(source, probe);
  });

  afterAll(async () => {
    if (runner !== undefined) {
      await runner.query(`SET search_path TO public`);
      await runner.query(`DROP SCHEMA IF EXISTS "${PROBE_SCHEMA}" CASCADE`);
      await runner.release();
    }
    if (dataSource !== undefined) {
      await dataSource.destroy();
    }
  });

  it('up이 스펙의 테이블과 enum을 만든다', () => {
    // down 단언이 공허해지지 않게 up의 결과부터 고정한다 — up이 아무것도 만들지 않았다면
    // "down 뒤에 아무것도 없다"는 저절로 통과한다.
    expect(afterUp.tables).toEqual([
      'categories',
      'example_tags',
      'examples',
      'refresh_sessions',
      'tags',
      'users',
    ]);
    expect(afterUp.enums).toEqual(['example_status']);
    expect(afterUp.indexes).toContain('IDX_examples_created_at_id');
  });

  it('down이 테이블을 남기지 않는다', () => {
    expect(afterDown.tables).toEqual([]);
  });

  it('down이 enum 타입을 남기지 않는다', () => {
    // 테이블만 지우고 `CREATE TYPE`을 되돌리지 않는 것이 흔한 실수다. 그러면 되돌린 뒤
    // 다시 올릴 때 `type "example_status" already exists`로 실패한다.
    expect(afterDown.enums).toEqual([]);
  });

  it('down이 인덱스를 남기지 않는다', () => {
    expect(afterDown.indexes).toEqual([]);
  });
});
