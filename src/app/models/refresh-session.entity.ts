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

/**
 * refresh token 한 장의 수명.
 *
 * token 자체도 그 해시도 저장하지 않는다. refresh token은 `jti`가 이 행의 id인
 * JWT라, 위조는 서명 검증이 막고 폐기 여부는 이 행이 말한다. 해시 컬럼을 두면 갱신
 * 한 번마다 argon2 검증이 붙는데, 서명 검증이 이미 하는 일을 한 번 더 하는 것이다.
 *
 * `replacedById`가 자기 테이블을 가리키는 이유: 회전은 옛 세션을 폐기하고 새 세션을
 * 만드는 일이라, 둘을 이어 두면 "이 세션이 무엇으로 바뀌었는가"를 뒤늦게도 볼 수 있다.
 * `ON DELETE SET NULL`이라 새 세션이 지워져도 옛 행이 함께 사라지지 않는다 — 감사
 * 흔적이 지워지는 쪽이 더 나쁘다.
 *
 * `expires_at`·`user_id` 인덱스를 선언하는 이유: 마이그레이션이 같은 이름으로 실제
 * 인덱스를 만드는데, 여기서 선언을 생략하면 TypeORM이 "메타데이터에 없는 인덱스"로
 * 보고 `dataSource.driver.createSchemaBuilder().log()`에서 지우려 든다. 이름을
 * 명시하는 이유는 다른 인덱스와 같다 — 생략하면 해시 이름이 생겨 마이그레이션이 만든
 * `IDX_refresh_sessions_expires_at`/`IDX_refresh_sessions_user_id`와 어긋난다.
 */
@Index('IDX_refresh_sessions_expires_at', ['expiresAt'])
@Index('IDX_refresh_sessions_user_id', ['userId'])
@Entity({ name: 'refresh_sessions' })
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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
