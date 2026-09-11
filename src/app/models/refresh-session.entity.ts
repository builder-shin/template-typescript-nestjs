import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity.js';

/** Stores SHA-256 token digests and rotation history; never stores raw tokens. */
@Index('UQ_refresh_sessions_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_refresh_sessions_expires_at', ['expiresAt'])
@Index('IDX_refresh_sessions_user_id', ['userId'])
@Index('IDX_refresh_sessions_replaced_by_id', ['replacedById'])
@Entity({ name: 'refresh_sessions' })
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_refresh_sessions_user' })
  user?: User;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true })
  replacedById!: string | null;

  @ManyToOne(() => RefreshSession, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'replaced_by_id',
    foreignKeyConstraintName: 'FK_refresh_sessions_replaced_by',
  })
  replacedBy?: RefreshSession | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
