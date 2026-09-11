import type { MigrationInterface, QueryRunner } from 'typeorm';
import { canonicalEmail } from '../../app/auth/email-identity.js';
interface Identity {
  id: string;
  email: string;
  original_email?: string;
  canonical_email?: string;
}
export class NormalizeEmailIdentities1789124400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await this.atomic(runner, async () => {
      await runner.query('LOCK TABLE users IN ACCESS EXCLUSIVE MODE');
      const users = await runner.dataSource.query<Identity[]>(
        'SELECT id, email FROM users ORDER BY id',
        [],
        runner,
      );
      const changed: { id: string; original: string; canonical: string }[] = [];
      const seen = new Set<string>();
      for (const user of users) {
        const canonical = canonicalEmail(user.email);
        if (canonical === undefined)
          throw new Error(
            'Email identity migration requires explicit correction of an address rejected by login validation',
          );
        if (seen.has(canonical))
          throw new Error('Email normalization collision requires explicit account correction');
        seen.add(canonical);
        if (canonical !== user.email)
          changed.push({ id: user.id, original: user.email, canonical });
      }
      await runner.query(
        'CREATE TABLE email_identity_backups (user_id uuid NOT NULL, original_email varchar(254) NOT NULL, canonical_email varchar(254) NOT NULL, CONSTRAINT "PK_email_identity_backups" PRIMARY KEY (user_id))',
      );
      for (const user of changed) {
        await runner.query('INSERT INTO email_identity_backups VALUES ($1,$2,$3)', [
          user.id,
          user.original,
          user.canonical,
        ]);
        await runner.query('UPDATE users SET email=$1 WHERE id=$2', [user.canonical, user.id]);
      }
    });
  }
  async down(runner: QueryRunner): Promise<void> {
    await this.atomic(runner, async () => {
      await runner.query('LOCK TABLE users, email_identity_backups IN ACCESS EXCLUSIVE MODE');
      const users = await runner.dataSource.query<Identity[]>(
        'SELECT u.id,u.email,b.original_email,b.canonical_email FROM users u LEFT JOIN email_identity_backups b ON b.user_id=u.id ORDER BY u.id',
        [],
        runner,
      );
      const seen = new Set<string>();
      for (const user of users) {
        const target =
          user.email === user.canonical_email ? (user.original_email ?? user.email) : user.email;
        if (seen.has(target))
          throw new Error('Email rollback collision requires explicit account correction');
        seen.add(target);
      }
      for (const user of users) {
        if (user.email === user.canonical_email)
          await runner.query('UPDATE users SET email=$1 WHERE id=$2', [
            user.original_email,
            user.id,
          ]);
      }
      await runner.query('DROP TABLE email_identity_backups');
    });
  }
  private async atomic(runner: QueryRunner, operation: () => Promise<void>): Promise<void> {
    const owns = !runner.isTransactionActive;
    if (owns) await runner.startTransaction();
    try {
      await operation();
      if (owns) await runner.commitTransaction();
    } catch (error: unknown) {
      if (owns) await runner.rollbackTransaction();
      throw error;
    }
  }
}
