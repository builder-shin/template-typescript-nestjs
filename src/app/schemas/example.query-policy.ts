import { EXAMPLE_STATUSES } from '../models/example.entity.js';
import type { QueryPolicy } from './query-policy.js';

/**
 * Example의 조회 허용 목록.
 *
 * **인덱스 판단 (스펙 8.3)** — 모든 정렬 뒤에 `id ASC`가 붙으므로 유용한 인덱스는
 * `(<컬럼>, id)`다.
 *
 * - `createdAt` 정렬: `IDX_examples_created_at_id`가 초기 스키마에 이미 있다.
 * - `title` 정렬: `IDX_examples_title_id`가 있다.
 * - `status`·`score`·`updatedAt` 정렬: 인덱스를 **만들지 않는다.** `status`는 값이 3종,
 *   `score`는 0~100 정수로 둘 다 선택도가 낮아 플래너가 순차 스캔을 고르기 쉽다.
 *   `updatedAt`은 정본도 인덱싱하지 않는다 — 목록의 주 부하 경로가 아니다. 정본은
 *   기본 정렬 하나와 FK만 인덱싱하며, 이 저장소가 그보다 많이 갖고 있던 쪽이다.
 * - `status`·`category.id` 필터: 인덱스를 만들지 않는다. 위와 같은 이유이고, 정렬을
 *   동반한 목록 조회는 `(정렬 컬럼, id)` 인덱스가 이미 이끈다. 분류 수가 크게 늘거나
 *   특정 상태만 조회하는 경로가 주된 부하가 되면 그때 `(category_id, created_at, id)`
 *   같은 복합 인덱스를 같은 규칙으로 판단해 추가한다.
 * - `title`의 `contains`는 `LIKE '%...%'`로 컴파일되어 어떤 btree도 못 탄다. pg_trgm
 *   도입은 실제 사용 패턴이 정당화할 때까지 미루고, 연산자는 공개 허용 목록에 남긴다.
 *
 * **`id`는 정렬 목록에 없다.** tie breaker 전용이다 — 정본의 공개 정렬에 `id`가 없고,
 * 열어 두면 `sort=id`가 여기서만 200을 낸다.
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
      type: 'number',
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
