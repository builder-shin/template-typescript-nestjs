import {
  Check,
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
export type ExampleStatus = 'draft' | 'active' | 'archived';

/** 허용되는 상태 값. 마이그레이션의 enum 정의와 이 배열이 같아야 한다. */
export const EXAMPLE_STATUSES: readonly ExampleStatus[] = ['draft', 'active', 'archived'];

/**
 * 이 템플릿의 견본 자원.
 *
 * to-one(`category`)과 to-many(`tags`)를 모두 갖는 이유는 Phase 4의 관계 라우트
 * 등록이 두 cardinality를 모두 다루는지 이 자원 하나로 검증하기 위해서다.
 *
 * `(created_at, id)`·`(title, id)` 인덱스: 스펙 8.3에 따라 모든 정렬 뒤에 `id ASC`가
 * tie breaker로 덧붙으므로, 정렬이 실제로 인덱스를 타려면 두 컬럼이 함께 있어야 한다.
 *
 * 세 백엔드는 기본 정렬(created_at DESC, id ASC), title 정렬, category FK의
 * 접근 경로를 공유한다. 나머지 정렬은 별도 인덱스 없이 동작한다.
 *
 * 이름을 명시하는 이유: 이름을 생략하면 TypeORM이 해시 이름을 만들어 마이그레이션이
 * 만든 `IDX_examples_created_at_id`와 어긋난다. `test/integration/migrations.spec.ts`의
 * "엔티티 메타데이터가 실제 스키마와 어긋나지 않는다" 테스트가 그 어긋남을 잡아낸다.
 * `@Check`의 이름도 같은 이유로 명시한다.
 */
// TypeORM does not model PostgreSQL per-column index directions. Keep the
// migration-owned index and verify its complete definition in migrations.spec.ts.
@Index('IDX_examples_created_at_id', { synchronize: false })
@Index('IDX_examples_title_id', ['title', 'id'])
@Index('IDX_examples_category_id', ['categoryId'])
@Check('CHK_examples_score_range', `"score" >= 0 AND "score" <= 100`)
@Entity({ name: 'examples' })
export class Example {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: EXAMPLE_STATUSES,
    enumName: 'example_status',
  })
  status!: ExampleStatus;

  @Column({ name: 'score', type: 'integer' })
  score!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  /**
   * 분류. `ON DELETE SET NULL` — 분류가 사라져도 Example은 남는다.
   * 분류 삭제가 본문 삭제로 번지면 데이터 손실이 조용히 일어난다.
   *
   * `foreignKeyConstraintName`을 명시하는 이유: 생략하면 TypeORM이 해시 이름을 만들어
   * 마이그레이션이 만든 `FK_examples_category`와 어긋난다.
   */
  @ManyToOne(() => Category, (category) => category.examples, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id', foreignKeyConstraintName: 'FK_examples_category' })
  category?: Category | null;

  /**
   * 라벨. 조인 테이블의 소유자는 이쪽이다.
   *
   * `onDelete`/`onUpdate`를 양쪽 관계에 명시하는 이유: 조인 테이블의 두 FK는
   * TypeORM이 서로 다른 기본값을 적용한다 — 소유 쪽(`Example.tags`)은 생략 시
   * CASCADE/CASCADE로 기본값이 채워지지만, 반대 쪽(`Tag.examples`)은 생략 시
   * NO ACTION/NO ACTION이 된다. 어느 한쪽이라도 생략하면 두 방향의 삭제 전파가
   * 어긋나고, `dataSource.driver.createSchemaBuilder().log()`가 그 차이를 잡아낸다.
   * 여기서는 두 방향 모두 CASCADE로 명시해 관계가 사라지면 조인 행도 함께
   * 사라지도록 맞춘다(마이그레이션의 `ON DELETE CASCADE ON UPDATE CASCADE`와 대응).
   *
   * `foreignKeyConstraintName`도 명시한다 — 생략하면 해시 이름이 되어 마이그레이션의
   * `FK_example_tags_example`/`FK_example_tags_tag`와 어긋난다. 다만 조인 테이블
   * 자신의 인덱스 이름(`IDX_example_tags_*`)은 TypeORM이 항상 해시로만 만들고
   * 데코레이터로 재정의할 수 있는 자리가 없다 — 그 인덱스들은 마이그레이션 쪽을
   * TypeORM이 실제로 계산한 해시 이름에 맞춰 두었다(마이그레이션 주석 참고).
   */
  @ManyToMany(() => Tag, (tag) => tag.examples, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinTable({
    name: 'example_tags',
    joinColumn: {
      name: 'example_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_example_tags_example',
    },
    inverseJoinColumn: {
      name: 'tag_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_example_tags_tag',
    },
  })
  tags?: Tag[];
}
