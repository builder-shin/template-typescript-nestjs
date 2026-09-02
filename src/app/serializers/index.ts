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
 * 이 저장소가 아는 시리얼라이저의 유일한 목록.
 *
 * 엔티티·마이그레이션 목록과 같은 계약이다 — glob으로 탐색하지 않고, 이 배열에 없는
 * 시리얼라이저는 존재하지 않는 것과 같다.
 */
export const SERIALIZERS: readonly ErasedSerializer[] = [
  ERASED_EXAMPLE_SERIALIZER,
  ERASED_CATEGORY_SERIALIZER,
  ERASED_TAG_SERIALIZER,
];
