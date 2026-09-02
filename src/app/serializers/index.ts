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
 * `included` 조립과 관계 대상에 쓰는, `ErasedSerializer`를 구현한 시리얼라이저 목록.
 *
 * 엔티티·마이그레이션 목록과 같은 계약이다 — glob으로 탐색하지 않고, 이 배열에 없는
 * 시리얼라이저는 관계 대상으로도 `included`로도 쓸 수 없다.
 *
 * "저장소가 아는 전부"는 아니다. `USER_SERIALIZER`·`AUTH_TOKENS_SERIALIZER`처럼
 * 관계 대상이 아니고 `serializeUnknown`을 구현하지 않는 시리얼라이저는 이 배열 밖에
 * 있어도 정상이다 — 타입이 `ErasedSerializer[]`라 애초에 들어올 수도 없다.
 */
export const SERIALIZERS: readonly ErasedSerializer[] = [
  ERASED_EXAMPLE_SERIALIZER,
  ERASED_CATEGORY_SERIALIZER,
  ERASED_TAG_SERIALIZER,
];
