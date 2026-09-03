import { EXAMPLE_STATUSES } from '../models/example.entity.js';
import type { QueryPolicy } from './query-policy.js';

/**
 * Example의 조회 허용 목록.
 *
 * **인덱스 판단 (스펙 8.3)** — 모든 정렬 뒤에 `id ASC`가 붙으므로 유용한 인덱스는
 * `(<컬럼>, id)`다.
 *
 * - `createdAt` 정렬: `IDX_examples_created_at_id`가 초기 스키마에 이미 있다.
 * - `title` 정렬: `IDX_examples_title_id`를 이 정책과 같은 변경에서 만들었다.
 * - `publishedAt` 정렬: `IDX_examples_published_at_id`를 같은 변경에서 만들었다.
 * - `id` 정렬: 기본키 인덱스로 커버된다.
 * - `status`·`category` 필터: 인덱스를 **만들지 않는다**. 둘 다 선택도가 낮아(상태 3종,
 *   분류 소수) 인덱스가 있어도 플래너가 순차 스캔을 고르기 쉽고, 정렬을 동반한 목록
 *   조회는 위의 `(정렬 컬럼, id)` 인덱스가 이미 이끈다. 분류 수가 크게 늘거나 특정
 *   상태만 조회하는 경로가 주된 부하가 되면 그때 `(category_id, created_at, id)` 같은
 *   복합 인덱스를 같은 규칙으로 판단해 추가한다.
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
    // 공개 이름은 관계 이름, property는 FK 컬럼이다. 내부 컬럼 이름을 공개 표면에
    // 올리지 않으면서도 관계로 거를 수 있게 한다.
    category: { property: 'categoryId', type: 'uuid', operators: ['exact', 'in', 'isNull'] },
    createdAt: { property: 'createdAt', type: 'timestamp', operators: ['gt', 'gte', 'lt', 'lte'] },
    publishedAt: {
      property: 'publishedAt',
      type: 'timestamp',
      operators: ['gt', 'gte', 'lt', 'lte', 'isNull'],
    },
  },
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
    // NULL을 허용하므로 keyset 커서가 이 정렬을 거부한다(스펙 8.2).
    publishedAt: { property: 'publishedAt', nullable: true },
    title: { property: 'title', nullable: false },
    id: { property: 'id', nullable: false },
  },
  includes: ['category', 'tags'],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};
