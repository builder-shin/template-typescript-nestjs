import { Tag } from '../models/tag.entity.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';

/**
 * Tag의 공개 표현.
 *
 * `resourcePath`가 `TagsController`의 `@Controller` 경로와 같아야 하는 것,
 * JSON:API `type`이 URL 경로와 다른 것, 반대편 관계를 선언하지 않는 것 모두
 * `category.serializer.ts`의 주석과 같은 이유다. `attributes`가 `name` 하나뿐인
 * 것도 그 파일의 주석과 같은 이유다.
 */
export const TAG_SERIALIZER: ResourceSerializer<Tag> = {
  type: 'exampleTags',
  resourcePath: '/api/v1/tags',
  attributes: {
    name: (tag) => tag.name,
  },
  relationships: {},
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_TAG_SERIALIZER: ErasedSerializer = {
  type: TAG_SERIALIZER.type,
  resourcePath: TAG_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Tag)) {
      throw new TypeError('Tag 엔티티가 아니다');
    }
    return serializeResource(TAG_SERIALIZER, entity);
  },
};
