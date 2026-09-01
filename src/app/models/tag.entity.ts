import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Example } from './example.entity.js';

/**
 * Example에 붙는 라벨. to-many 관계의 대상이다.
 *
 * 조인 테이블의 소유자는 `Example` 쪽이다(`@JoinTable`이 거기 있다). 관계의 소유권을
 * 한쪽으로 고정해야 마이그레이션이 조인 테이블을 한 번만 만든다.
 */
@Entity({ name: 'tags' })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 60, unique: true })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // onDelete/onUpdate를 CASCADE로 명시하는 이유는 example.entity.ts의 tags 필드
  // 주석 참고 — 이 옵션을 생략하면 이 방향(tag_id FK)만 NO ACTION으로 남는다.
  @ManyToMany('Example', 'tags', { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  examples?: Example[];
}
