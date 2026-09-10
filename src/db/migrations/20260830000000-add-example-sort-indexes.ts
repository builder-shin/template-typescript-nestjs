import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `EXAMPLE_QUERY_POLICY`가 여는 정렬을 뒷받침하는 인덱스.
 *
 * 클래스명 끝의 `1788048000000`은 `2026-08-30T00:00:00Z`의 epoch millis다. 파일명의
 * `20260830000000`과 같은 시각을 가리켜야 한다.
 *
 * 스펙 8.3이 정렬을 여는 변경과 인덱스를 만드는 변경을 같은 커밋에 두라고 정한다.
 * 모든 정렬 뒤에 `id ASC`가 붙으므로 컬럼 조합은 `(<정렬 컬럼>, id)`다.
 */
export class AddExampleSortIndexes1788048000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_title_id" ON "examples" ("title", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_published_at_id" ON "examples" ("published_at", "id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_examples_published_at_id"`);
    await queryRunner.query(`DROP INDEX "IDX_examples_title_id"`);
  }
}
