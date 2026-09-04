import type { QueryPolicy } from './query-policy.js';

/**
 * 분류의 조회 허용 목록.
 *
 * 기본 정렬이 `name ASC`인 것은 의도된 것이다. 선택기는 알파벳순이 맞고, Example의
 * 기본 정렬(`createdAt DESC`)과 다른 것은 참조 데이터를 최신순으로 고르지 않기
 * 때문이다.
 *
 * `includes`가 비어 있는 것도 의도된 것이다. `examples` 역참조를 열면
 * Example → category → examples → … 로 순환이 생긴다.
 *
 * **인덱스 판단 — 만들지 않는다.** 근거가 "기존 인덱스로 커버된다"가 **아니다.**
 * `name`의 UNIQUE 인덱스가 `name` 순서를 주지만, PostgreSQL은 유니크 제약을 근거로
 * 뒤따르는 정렬 키를 지우지 않으므로 `ORDER BY name, id` 계획에는 incremental sort가
 * 남는다.
 *
 * 그럼에도 `(name, id)` 인덱스를 만들지 않는 이유는 둘이다. `name`이 유니크해서 동점
 * 그룹의 크기가 항상 1이라 그 정렬 단계가 실질적으로 하는 일이 없고, 참조 테이블의
 * 행 수가 작다(분류·라벨 각각 수십 개 규모). `createdAt` 정렬은 유니크가 아니라 동점
 * 그룹 논거가 적용되지 않지만, 행 수가 작아 결론은 같다. 행 수가 크게 늘어 이 목록이
 * 주된 부하가 되면 그때 `(name, id)`를 같은 규칙으로 판단해 추가한다.
 *
 * "정렬을 여는 변경은 인덱스를 진다"는 규칙이 요구하는 것은 인덱스 자체가 아니라 이
 * 판단의 기록이다.
 */
export const EXAMPLE_CATEGORY_QUERY_POLICY: QueryPolicy = {
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
