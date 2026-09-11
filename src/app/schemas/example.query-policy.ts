import { EXAMPLE_STATUSES } from '../models/example.entity.js';
import type { QueryPolicy } from './query-policy.js';

/**
 * Public query allowlist and physical index coverage.
 * Default ordering uses (created_at DESC, id ASC), title ordering uses
 * (title ASC, id ASC), and category.id uses the category_id foreign-key index.
 * Status, score, and updatedAt sorts remain available without dedicated indexes;
 * add indexes when measured access patterns justify their write cost.
 * Literal title contains uses LIKE '%...%' and cannot use a normal btree.
 * The id ASC tie breaker is internal and is not a public sort field.
 */
export const EXAMPLE_QUERY_POLICY: QueryPolicy = {
  filters: {
    title: { property: 'title', type: 'string', operators: ['exact', 'contains'] },
    status: {
      property: 'status',
      type: 'enum',
      operators: ['exact', 'in'],
      values: EXAMPLE_STATUSES,
    },
    score: {
      property: 'score',
      type: 'integer',
      operators: ['exact', 'gt', 'gte', 'lt', 'lte', 'in'],
    },
    // 공개 이름은 `<관계>.id`, property는 FK 컬럼이다. 내부 컬럼 이름을 공개 표면에
    // 올리지 않으면서도 관계로 거를 수 있게 한다. 정본이 쓰는 이름이 `category.id`다.
    'category.id': {
      property: 'categoryId',
      type: 'uuid',
      operators: ['exact', 'in', 'isNull'],
    },
    createdAt: {
      property: 'createdAt',
      type: 'timestamp',
      operators: ['exact', 'gt', 'gte', 'lt', 'lte'],
    },
  },
  sorts: {
    title: { property: 'title', nullable: false },
    status: { property: 'status', nullable: false },
    score: { property: 'score', nullable: false },
    createdAt: { property: 'createdAt', nullable: false },
    updatedAt: { property: 'updatedAt', nullable: false },
  },
  includes: ['category', 'tags'],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 20,
};
