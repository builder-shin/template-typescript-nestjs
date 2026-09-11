import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Example } from './example.entity.js';

/**
 * Example의 분류. to-one 관계의 대상이다.
 *
 * 관계 반대편(`examples`)을 문자열 참조로 선언한 이유: `Example`을 값으로 import하면
 * `example.entity.ts`와 순환 import가 된다. TypeORM은 lazy 문자열 참조를 지원하므로
 * 타입만 `import type`으로 가져오고 관계 대상은 문자열로 준다.
 */
@Entity({ name: 'categories' })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 200, unique: true })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany('Example', 'category')
  examples?: Example[];
}
