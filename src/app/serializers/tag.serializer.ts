import { Tag } from '../models/tag.entity.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';

/**
 * Tag의 공개 표현.
 *
 * `CATEGORY_SERIALIZER`와 같은 이유로 `resourcePath`가 없고 반대편 관계도 선언하지
 * 않는다(`category.serializer.ts` 주석 참고).
 */
export const TAG_SERIALIZER: ResourceSerializer<Tag> = {
  type: 'tags',
  attributes: {
    name: (tag) => tag.name,
    createdAt: (tag) => tag.createdAt.toISOString(),
    updatedAt: (tag) => tag.updatedAt.toISOString(),
  },
  relationships: {},
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_TAG_SERIALIZER: ErasedSerializer = {
  type: TAG_SERIALIZER.type,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Tag)) {
      throw new TypeError('Tag 엔티티가 아니다');
    }
    return serializeResource(TAG_SERIALIZER, entity);
  },
};
