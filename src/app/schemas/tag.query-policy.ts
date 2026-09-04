import type { QueryPolicy } from './query-policy.js';

/**
 * 라벨의 조회 허용 목록.
 *
 * 기본 정렬·`includes`·인덱스 판단의 근거는 `EXAMPLE_CATEGORY_QUERY_POLICY`와 같다.
 * `name`의 UNIQUE 인덱스가 `name` 순서를 주지만 `ORDER BY name, id`에는 incremental
 * sort가 남는다 — 그럼에도 만들지 않는 이유는 `name`이 유니크해서 동점 그룹이 항상
 * 1이고 라벨 수가 적다는 것이다. `createdAt`은 유니크가 아니라 동점 그룹 논거가
 * 적용되지 않지만 행 수가 작아 결론은 같다.
 */
export const EXAMPLE_TAG_QUERY_POLICY: QueryPolicy = {
  filters: {
    name: { property: 'name', type: 'string', operators: ['exact', 'contains'] },
  },
  sorts: {
    name: { property: 'name', nullable: false },
    createdAt: { property: 'createdAt', nullable: false },
  },
  includes: [],
  defaultSort: [{ field: 'name', direction: 'ASC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 20,
};
