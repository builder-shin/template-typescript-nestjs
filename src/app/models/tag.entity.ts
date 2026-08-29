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

  @ManyToMany('Example', 'tags')
  examples?: Example[];
}
