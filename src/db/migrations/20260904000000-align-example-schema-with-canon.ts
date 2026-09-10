import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Example 스키마를 정본(`template-python-fastapi`)에 맞춘다.
 *
 * 클래스명 끝의 `1788480000000`은 `2026-09-04T00:00:00Z`의 epoch millis다. 파일명의
 * `20260904000000`과 같은 시각을 가리켜야 한다.
 *
 * `score`가 NOT NULL인데 기존 행이 있으므로 기본값을 주고 추가한 뒤 기본값을 뗀다.
 * 기본값을 남기면 엔티티(기본값 없음)와 어긋나 `migrations.spec.ts`의 드리프트
 * 검사가 잡는다.
 *
 * enum은 `ALTER TYPE ... RENAME VALUE`다. 값을 바꾸는 것이 아니라 이름만 바꾸므로
 * 기존 행이 그대로 따라온다.
 *
 * `down()`은 `up()`을 역순으로 되돌린다. `description`으로 rename한 컬럼을 `body`로
 * 되돌리고, `score`를 지우고 `published_at`과 그 인덱스를 되살린다 — `published_at`의
 * 값은 복구되지 않는다(컬럼을 지웠으므로 남아 있지 않다). 되돌릴 수 없는 마이그레이션을
 * 받지 않는다는 규칙은 "스키마를 되돌릴 수 있는가"에 대한 것이고, 지운 데이터가
 * 돌아오는 것을 뜻하지 않는다.
 */
export class AlignExampleSchemaWithCanon1788480000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "examples" RENAME COLUMN "body" TO "description"`);

    // 인덱스를 먼저 지운다. 컬럼을 지우면 인덱스가 함께 사라지지만, 순서를 명시해야
    // down()의 역순이 그대로 대칭이 된다.
    await queryRunner.query(`DROP INDEX "IDX_examples_published_at_id"`);
    await queryRunner.query(`ALTER TABLE "examples" DROP COLUMN "published_at"`);

    await queryRunner.query(`ALTER TABLE "examples" ADD COLUMN "score" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "examples" ALTER COLUMN "score" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "examples"
      ADD CONSTRAINT "CHK_examples_score_range" CHECK ("score" >= 0 AND "score" <= 100)
    `);

    await queryRunner.query(`ALTER TYPE "example_status" RENAME VALUE 'published' TO 'active'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "example_status" RENAME VALUE 'active' TO 'published'`);

    await queryRunner.query(`ALTER TABLE "examples" DROP CONSTRAINT "CHK_examples_score_range"`);
    await queryRunner.query(`ALTER TABLE "examples" DROP COLUMN "score"`);

    await queryRunner.query(
      `ALTER TABLE "examples" ADD COLUMN "published_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_published_at_id" ON "examples" ("published_at", "id")
    `);

    await queryRunner.query(`ALTER TABLE "examples" RENAME COLUMN "description" TO "body"`);
  }
}
