import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../db/fixture.js';
import { AlignExampleIndexes1789131600000 } from '../../src/db/migrations/20260911130000-align-example-indexes.js';

describe('exact index migration rollback', () => {
  it('restores index directions and preserves seeded rows and column defaults', async () => {
    const db = await new DataSource({
      type: 'postgres',
      url: requireTestDatabaseUrl(),
    }).initialize();
    const runner = db.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      await runner.query('CREATE SCHEMA index_roundtrip_probe');
      await runner.query('SET LOCAL search_path TO index_roundtrip_probe');
      await runner.query(`CREATE TABLE examples (id uuid PRIMARY KEY,title varchar(200) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),category_id uuid,status varchar(20) NOT NULL,score integer NOT NULL)`);
      await runner.query(
        'CREATE INDEX "IDX_examples_created_at_id" ON examples(created_at ASC,id ASC)',
      );
      await runner.query('CREATE INDEX "IDX_examples_title_id" ON examples(title,id)');
      await runner.query(`INSERT INTO examples VALUES ('00000000-0000-0000-0000-000000000001','kept',
        '2026-09-11 01:02:03.123456+00',NULL,'active',42)`);
      const snapshot = (sql: string): Promise<Record<string, unknown>[]> =>
        db.query(sql, [], runner);
      const indexesSql =
        'SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY indexname';
      const columnsSql = `SELECT table_name,column_name,column_default,is_nullable,data_type
        FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position`;
      const rowsSql = 'SELECT row_to_json(t)::text FROM examples t ORDER BY id';
      const before = await snapshot(indexesSql);
      const columns = await snapshot(columnsSql);
      const rows = await snapshot(rowsSql);
      const migration = new AlignExampleIndexes1789131600000();
      await migration.up(runner);
      const after = await snapshot(indexesSql);
      expect(
        after.some((row) => String(row.indexdef).endsWith('btree (created_at DESC, id)')),
      ).toBe(true);
      expect(after.some((row) => String(row.indexdef).endsWith('btree (category_id)'))).toBe(true);
      expect(await snapshot(columnsSql)).toEqual(columns);
      expect(await snapshot(rowsSql)).toEqual(rows);
      await migration.down(runner);
      expect(await snapshot(indexesSql)).toEqual(before);
      expect(await snapshot(columnsSql)).toEqual(columns);
      expect(await snapshot(rowsSql)).toEqual(rows);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await db.destroy();
    }
  });
});
