import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Migration rollback history; intentionally excluded from public resource serializers. */
@Entity('email_identity_backups')
export class EmailIdentityBackup {
  @PrimaryColumn({
    type: 'uuid',
    name: 'user_id',
    primaryKeyConstraintName: 'PK_email_identity_backups',
  })
  userId!: string;
  @Column({ type: 'varchar', length: 254, name: 'original_email' })
  originalEmail!: string;
  @Column({ type: 'varchar', length: 254, name: 'canonical_email' })
  canonicalEmail!: string;
}
