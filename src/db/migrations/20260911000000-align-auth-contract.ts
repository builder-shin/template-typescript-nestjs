import { normalizeEmail } from '../../app/auth/normalize-email.js';
import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Preserve domain rows; legacy sessions have no raw token from which to recover a hash. */
export class AlignAuthContract1789084800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Hold a table lock so no writer can introduce a collision between preflight and UPDATE.
    // TypeORM normally owns this transaction; direct migration probes also need atomicity.
    const ownsTransaction = !queryRunner.isTransactionActive;
    if (ownsTransaction) await queryRunner.startTransaction();
    try {
      await queryRunner.query('LOCK TABLE users IN ACCESS EXCLUSIVE MODE');
      const users = await queryRunner.dataSource.query<{ id: string; email: string }[]>(
        'SELECT id, email FROM users ORDER BY id',
        [],
        queryRunner,
      );
      const normalized = users.map((user) => ({
        ...user,
        normalizedEmail: normalizeEmail(user.email),
      }));
      const seen = new Set<string>();
      for (const user of normalized) {
        if (Array.from(user.normalizedEmail).length > 254) {
          throw new Error(
            'Cannot narrow users.email to 254: existing oversized emails require correction after normalization',
          );
        }
        if (seen.has(user.normalizedEmail)) {
          throw new Error(
            'Cannot normalize users.email: email normalization collision requires explicit account correction',
          );
        }
        seen.add(user.normalizedEmail);
      }
      // Preflight every identity before touching any account. Never merge or delete collisions.
      for (const user of normalized) {
        if (user.email !== user.normalizedEmail) {
          await queryRunner.query('UPDATE users SET email = $1 WHERE id = $2', [
            user.normalizedEmail,
            user.id,
          ]);
        }
      }
      await queryRunner.query('ALTER TABLE examples ALTER COLUMN status DROP DEFAULT');
      await queryRunner.query('ALTER TABLE users ALTER COLUMN email TYPE varchar(254)');
      await queryRunner.query('ALTER TABLE categories ALTER COLUMN name TYPE varchar(200)');
      await queryRunner.query('ALTER TABLE tags ALTER COLUMN name TYPE varchar(200)');
      await queryRunner.query('ALTER TABLE refresh_sessions ADD COLUMN token_hash varchar(64)');
      // Non-hex sentinels cannot pass hash verification. Keep rows and replacement history.
      await queryRunner.query(`UPDATE refresh_sessions SET token_hash = 'legacy-revoked:' || id::text,
      revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)`);
      await queryRunner.query('ALTER TABLE refresh_sessions ALTER COLUMN token_hash SET NOT NULL');
      await queryRunner.query(
        'CREATE UNIQUE INDEX "UQ_refresh_sessions_token_hash" ON refresh_sessions (token_hash)',
      );
      if (ownsTransaction) await queryRunner.commitTransaction();
    } catch (error: unknown) {
      if (ownsTransaction) await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE examples ALTER COLUMN status SET DEFAULT 'draft'");
    // PostgreSQL refuses narrowing if newer names exceed old limits; never truncate data.
    await queryRunner.query('ALTER TABLE tags ALTER COLUMN name TYPE varchar(60)');
    await queryRunner.query('ALTER TABLE categories ALTER COLUMN name TYPE varchar(120)');
    await queryRunner.query('ALTER TABLE users ALTER COLUMN email TYPE varchar(320)');
    await queryRunner.query('ALTER TABLE refresh_sessions DROP COLUMN token_hash');
  }
}
