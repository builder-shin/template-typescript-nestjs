import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Example·Category·Tag 초기 스키마.
 *
 * 클래스명 끝의 `1787961600000`은 `2026-08-29T00:00:00Z`의 epoch millis다. TypeORM은
 * 이 숫자를 파싱해 실행 순서를 정하므로, 파일명의 `20260829000000`과 같은 시각을
 * 가리켜야 한다. 어긋나면 파일 이름 순서와 실제 실행 순서가 갈라진다.
 *
 * `down()`은 `up()`이 만든 것을 역순으로 지운다. 되돌릴 수 없는 마이그레이션은
 * 받지 않으므로 비워 두지 않는다.
 */
export class CreateExampleSchema1787961600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TYPE "example_status" AS ENUM ('draft', 'published', 'archived')
    `);

    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_categories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_categories_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tags" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(60) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tags" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tags_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "examples" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying(200) NOT NULL,
        "body" text,
        "status" "example_status" NOT NULL DEFAULT 'draft',
        "published_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "category_id" uuid,
        CONSTRAINT "PK_examples" PRIMARY KEY ("id"),
        CONSTRAINT "FK_examples_category" FOREIGN KEY ("category_id")
          REFERENCES "categories" ("id") ON DELETE SET NULL
      )
    `);

    // 스펙 8.3: 모든 정렬에 id ASC가 tie breaker로 덧붙으므로 (컬럼, id)가 유용한 인덱스다.
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_created_at_id" ON "examples" ("created_at", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "example_tags" (
        "example_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        CONSTRAINT "PK_example_tags" PRIMARY KEY ("example_id", "tag_id"),
        CONSTRAINT "FK_example_tags_example" FOREIGN KEY ("example_id")
          REFERENCES "examples" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_example_tags_tag" FOREIGN KEY ("tag_id")
          REFERENCES "tags" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    // 조인 테이블 양쪽 컬럼의 인덱스.
    //
    // PK가 (example_id, tag_id)이므로 example_id 단독 조회는 PK 인덱스의 선두 컬럼으로
    // 이미 커버된다 — 원칙대로라면 example_id 인덱스는 중복이다. 그런데도 두 개를 다
    // 만드는 이유: TypeORM의 JunctionEntityMetadataBuilder는 many-to-many 조인 테이블에
    // 두 컬럼 모두의 인덱스를 무조건 만들고(entity-metadata-builder/JunctionEntityMetadataBuilder.js
    // 의 `ownIndices`), 이 인덱스 두 개는 데코레이터로 이름을 줄 자리가 없어 항상
    // `DefaultNamingStrategy.indexName()`의 해시로만 이름이 정해진다. 그래서 여기 이름을
    // 읽기 좋게 고를 수 없다 — TypeORM이 실제로 계산하는 해시 이름을 그대로 옮겨 적어야
    // `dataSource.driver.createSchemaBuilder().log()`가 빈 배열을 돌려준다. 이름이 이렇게
    // 낯설게 보이는 것은 실수가 아니라 TypeORM 내부 동작에 맞춘 결과다.
    //
    // 태그로 Example을 찾는 역방향 조회(tag_id 단독)는 어차피 별도 인덱스가 필요하다.
    await queryRunner.query(`
      CREATE INDEX "IDX_6dbc9d7ff399e66c0d12a837aa" ON "example_tags" ("example_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_da9ba1859dfab6ed1e21cc70e2" ON "example_tags" ("tag_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_da9ba1859dfab6ed1e21cc70e2"`);
    await queryRunner.query(`DROP INDEX "IDX_6dbc9d7ff399e66c0d12a837aa"`);
    await queryRunner.query(`DROP TABLE "example_tags"`);
    await queryRunner.query(`DROP INDEX "IDX_examples_created_at_id"`);
    await queryRunner.query(`DROP TABLE "examples"`);
    await queryRunner.query(`DROP TABLE "tags"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TYPE "example_status"`);
    // pgcrypto는 다른 마이그레이션도 쓸 수 있으므로 내리지 않는다.
  }
}
