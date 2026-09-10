import { ERASED_CATEGORY_SERIALIZER } from './category.serializer.js';
import { ERASED_EXAMPLE_SERIALIZER } from './example.serializer.js';
import type { ErasedSerializer } from './serializer.js';
import { ERASED_TAG_SERIALIZER } from './tag.serializer.js';

export { AUTH_TOKENS_SERIALIZER } from './auth-tokens.serializer.js';
export type { AuthTokens } from './auth-tokens.serializer.js';
export { CATEGORY_SERIALIZER, ERASED_CATEGORY_SERIALIZER } from './category.serializer.js';
export { EXAMPLE_SERIALIZER, ERASED_EXAMPLE_SERIALIZER } from './example.serializer.js';
export { TAG_SERIALIZER, ERASED_TAG_SERIALIZER } from './tag.serializer.js';
export { USER_SERIALIZER } from './user.serializer.js';
export { collectIncluded, serializeResource } from './serializer.js';
export type {
  ErasedSerializer,
  RelationshipCardinality,
  RelationshipDefinition,
  RelationshipObject,
  ResourceObject,
  ResourceSerializer,
} from './serializer.js';

/**
 * `ErasedSerializer`를 구현한 시리얼라이저의 명시적 목록.
 *
 * **런타임에 이 배열을 읽는 곳은 없다.** 관계 대상은 각 시리얼라이저가 자기
 * `relationships`에 적어 둔 `target()` 클로저가 정하고, `included`는 `collectIncluded`가
 * 소유 시리얼라이저의 `relationships`를 따라가며 조립한다 — 둘 다 이 배열을 거치지
 * 않는다. 이 배열을 읽는 것은 그 구성을 고정하는 테스트 하나뿐이다
 * (`test/serializers/example.serializer.spec.ts`).
 *
 * 그래서 이 배열의 값은 "무엇이 erased 시리얼라이저인가"를 한 곳에 드러내고, 그
 * 목록이 바뀔 때 테스트가 반드시 함께 고쳐지게 만드는 것이다. 엔티티·마이그레이션
 * 배열과 겉모양은 같지만 성격이 다르다 — 그 둘은 TypeORM이 실제로 소비한다.
 *
 * "저장소가 아는 전부"도 아니다. `USER_SERIALIZER`·`AUTH_TOKENS_SERIALIZER`처럼
 * `serializeUnknown`을 구현하지 않는 시리얼라이저는 이 배열 밖에 있어도 정상이다 —
 * 타입이 `ErasedSerializer[]`라 애초에 들어올 수도 없다.
 */
export const SERIALIZERS: readonly ErasedSerializer[] = [
  ERASED_EXAMPLE_SERIALIZER,
  ERASED_CATEGORY_SERIALIZER,
  ERASED_TAG_SERIALIZER,
];
