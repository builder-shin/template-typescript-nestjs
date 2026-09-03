import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 인증 주체.
 *
 * `email`은 소문자로 정규화해 저장한다. 대소문자만 다른 두 계정이 생기면 로그인이
 * 어느 쪽으로 붙을지 입력에 따라 갈리고, 그 상태는 유니크 제약으로 되돌릴 수 없다.
 * 정규화 지점은 쓰기 스키마 하나뿐이다(`auth.schemas.ts`) — 여기서 또 하면 두 곳이
 * 갈릴 수 있다.
 *
 * 길이 320은 RFC 5321의 이메일 최대 길이다. 컬럼이 스키마보다 좁으면 사용자 입력
 * 오류가 422가 아니라 500으로 나간다.
 *
 * `passwordHash`는 시리얼라이저에 절대 오르지 않는다 — `user.serializer.ts`가
 * attributes에서 뺀 것으로 그것을 강제한다.
 */
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'email', type: 'varchar', length: 320, unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
