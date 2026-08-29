import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from './category.entity.js';
import { Tag } from './tag.entity.js';

/** Example의 상태. 저장 형식은 PostgreSQL enum이다. */
export type ExampleStatus = 'draft' | 'published' | 'archived';

/** 허용되는 상태 값. 마이그레이션의 enum 정의와 이 배열이 같아야 한다. */
export const EXAMPLE_STATUSES: readonly ExampleStatus[] = ['draft', 'published', 'archived'];

/**
 * 이 템플릿의 견본 자원.
 *
 * to-one(`category`)과 to-many(`tags`)를 모두 갖는 이유는 Phase 4의 관계 라우트
 * 등록이 두 cardinality를 모두 다루는지 이 자원 하나로 검증하기 위해서다.
 *
 * `(created_at, id)` 인덱스: 스펙 8.3에 따라 모든 정렬 뒤에 `id ASC`가 tie breaker로
 * 덧붙으므로, 기본 정렬 `created_at DESC`가 실제로 인덱스를 타려면 두 컬럼이 함께
 * 있어야 한다. `title` 정렬 인덱스는 Phase 3에서 QueryPolicy에 정렬을 열 때 함께 판단한다.
 */
@Index(['createdAt', 'id'])
@Entity({ name: 'examples' })
export class Example {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'body', type: 'text', nullable: true })
  body!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: EXAMPLE_STATUSES,
    enumName: 'example_status',
    default: 'draft',
  })
  status!: ExampleStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  /**
   * 분류. `ON DELETE SET NULL` — 분류가 사라져도 Example은 남는다.
   * 분류 삭제가 본문 삭제로 번지면 데이터 손실이 조용히 일어난다.
   */
  @ManyToOne(() => Category, (category) => category.examples, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  /** 라벨. 조인 테이블의 소유자는 이쪽이다. */
  @ManyToMany(() => Tag, (tag) => tag.examples)
  @JoinTable({
    name: 'example_tags',
    joinColumn: { name: 'example_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags?: Tag[];
}
