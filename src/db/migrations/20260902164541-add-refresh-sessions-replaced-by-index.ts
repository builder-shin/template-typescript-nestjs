import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `refresh_sessions.replaced_by_id`의 인덱스.
 *
 * 클래스명 끝의 `1788367541000`은 `2026-09-02T16:45:41Z`의 epoch millis다. 파일명의
 * `20260902164541`과 같은 시각을 가리켜야 한다.
 *
 * **왜 지금 추가하는가.** `FK_refresh_sessions_replaced_by`는 `ON DELETE SET NULL`로
 * 자기 테이블을 참조한다(`20260902000000-create-auth-schema.ts`). `purgeExpiredRefreshSessions`가
 * 만료된 행 B를 지우면, PostgreSQL은 B를 가리키던 다른 행의 `replaced_by_id`를 NULL로
 * 되돌리기 위해 `UPDATE refresh_sessions SET replaced_by_id = NULL WHERE replaced_by_id = $1`을
 * **지운 행마다 한 번씩** 실행한다. `purge-expired-refresh-sessions.ts`의 docstring은 이
 * cascade가 만드는 잠금 경합(55P03)을 실측해 `lockTimeoutMs`로 대응했지만, 인덱스 없이
 * 이 UPDATE가 순차 스캔으로 도는 **비용**까지는 다루지 않았다. `PURGE_BATCH_SIZE`가
 * 500이므로(`dispatch.ts`), 행이 백만 단위인 테이블에서는 배치 하나가 최대 500번의
 * 전체 테이블 스캔을 유발할 수 있다 — `SET LOCAL lock_timeout`은 잠금 **대기** 시간만
 * 자르고 `MAX_BATCHES`는 왕복 **횟수**만 세므로, 둘 다 이 스캔 비용 자체는 막지 못한다.
 *
 * **왜 적용된 마이그레이션을 고치지 않고 새로 추가하는가.** 스펙 11장은 스키마 변경을
 * 새 마이그레이션으로만 전달하라고 정한다. `20260902000000-create-auth-schema.ts`를
 * 직접 고치면 그 파일을 만드는 새 데이터베이스에서만 인덱스가 생기고, 이미 그
 * 마이그레이션을 적용해 둔 환경(스테이징 등)은 `MIGRATIONS` 배열에 새 항목이 없는 한
 * 영원히 인덱스 없이 남는다 — 바로 이 규칙이 막으려는 드리프트다.
 */
export class AddRefreshSessionsReplacedByIndex1788367541000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_sessions_replaced_by_id" ON "refresh_sessions" ("replaced_by_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_refresh_sessions_replaced_by_id"`);
  }
}
