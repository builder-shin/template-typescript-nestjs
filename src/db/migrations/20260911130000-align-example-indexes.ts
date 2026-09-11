import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Shared default ordering and the category foreign-key access path. */
export class AlignExampleIndexes1789131600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_examples_created_at_id"');
    await queryRunner.query(
      'CREATE INDEX "IDX_examples_created_at_id" ON examples (created_at DESC, id ASC)',
    );
    await queryRunner.query('CREATE INDEX "IDX_examples_category_id" ON examples (category_id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_examples_category_id"');
    await queryRunner.query('DROP INDEX "IDX_examples_created_at_id"');
    await queryRunner.query(
      'CREATE INDEX "IDX_examples_created_at_id" ON examples (created_at ASC, id ASC)',
    );
  }
}
