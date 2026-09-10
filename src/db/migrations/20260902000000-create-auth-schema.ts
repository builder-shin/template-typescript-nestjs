import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 인증 테이블 두 개.
 *
 * 클래스명 끝의 `1788307200000`은 `2026-09-02T00:00:00Z`의 epoch millis다. 파일명의
 * `20260902000000`과 같은 시각을 가리켜야 한다(스펙 11.1).
 *
 * `replaced_by_id`의 자기참조 FK를 `CREATE TABLE` 안에 인라인으로 둔다 — 실측으로
 * 단일 문장 안에서 자기 자신을 참조할 수 있음을 확인했다. 따로 `ALTER TABLE`로 붙이면
 * `down()`에서 지우는 순서를 하나 더 관리해야 한다.
 *
 * `users(email)`의 유일성은 `categories(name)`·`tags(name)`과 같은 패턴으로 이름 붙인
 * UNIQUE 제약으로 만든다 — 컬럼 제약처럼 보이지만 실제로는 named CONSTRAINT다.
 * `User` 엔티티의 `@Column({ unique: true })`가 TypeORM 메타데이터에 만드는 것도
 * 인덱스가 아니라 이름 붙인 unique 제약이므로, 여기서 순수 `CREATE UNIQUE INDEX`로
 * 만들면 이름이 같아도 종류가 달라 드리프트 검사(`dataSource.driver
 * .createSchemaBuilder().log()`)가 인덱스는 지우고 제약은 새로 만들려 든다 — 실측으로
 * 확인했다. 제약이어도 위반 시 PostgreSQL 오류에 이름이 그대로 실린다
 * (`duplicate key value violates unique constraint "UQ_users_email"`)로 `auth.controller.ts`가
 * 이름으로 EMAIL_ALREADY_REGISTERED를 가리는 데는 지장이 없다.
 */
export class CreateAuthSchema1788307200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(320) NOT NULL,
        "password_hash" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "replaced_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_sessions_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_refresh_sessions_replaced_by"
          FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_sessions" ("id") ON DELETE SET NULL
      )
    `);
    // 갱신·로그아웃은 언제나 id로 한 행을 찾으므로 PK로 충분하다. 아래 `expires_at`
    // 인덱스는 Phase 7의 `purgeExpiredRefreshSessions`가 배치의 후보를 고르는 SELECT
    // (`expires_at < $1 ORDER BY expires_at ... LIMIT $2`)가 테이블을 통째로 읽지
    // 않게 한다 — **그 SELECT까지다.** 후보를 실제로 지우는 DELETE 자체가 촉발하는
    // 참조 무결성 확인(다른 행이 `replaced_by_id`로 이 행을 가리키면 그 값을 NULL로
    // 되돌리는 것)은 이 인덱스와 무관한 별개 컬럼·별개 스캔이다 — 그래서
    // `20260902164541-add-refresh-sessions-replaced-by-index.ts`가 별도 인덱스를
    // 추가한다. 이름은 `RefreshSession` 엔티티의 `@Index` 데코레이터가 선언하는
    // 이름과 같아야 드리프트 검사가 조용하다.
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_sessions_expires_at" ON "refresh_sessions" ("expires_at")
    `);
    // 이 인덱스는 위와 달리 purge 잡과 무관하다 — 이 저장소 어디에도 `refresh_sessions`를
    // `user_id`로 조회·정렬하는 질의가 없다(모든 조회는 PK인 `id`로 한다,
    // `refresh-session.ts`의 `lockSession` 참고). 존재 이유는 `FK_refresh_sessions_user`의
    // `ON DELETE CASCADE`다 — `users` 행 하나가 지워지면 PostgreSQL이 이 컬럼으로
    // 딸린 `refresh_sessions` 행을 찾아 함께 지우는데, 인덱스가 없으면 그 탐색이 순차
    // 스캔이 된다. `replaced_by_id`의 `ON DELETE SET NULL` cascade가 같은 이유로
    // 인덱스가 필요했던 것(`20260902164541-add-refresh-sessions-replaced-by-index.ts`
    // 참고 — 이 컬럼은 그 교훈을 반영해 처음부터 인덱스를 함께 만든다)과 같은 사정이다.
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_sessions_user_id" ON "refresh_sessions" ("user_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // `refresh_sessions`가 `users`를 참조하므로 먼저 지운다. 인덱스와 제약은 테이블과
    // 함께 사라지므로 따로 지우지 않는다 — 남겨 두면 이미 없는 것을 지우려다 `down()`이
    // 실패한다.
    await queryRunner.query(`DROP TABLE "refresh_sessions"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
