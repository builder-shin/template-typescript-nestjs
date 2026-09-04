import { Category } from '../models/category.entity.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';

/**
 * Category의 공개 표현.
 *
 * `resourcePath`가 없다. 스펙 16장의 공개 API 표면에 `/api/v1/categories` 라우트가
 * 없기 때문이다 — 이 자원은 Example의 `include`로만 밖에 나간다. 없는 URL을 가리키는
 * `self` 링크를 지어내지 않는다.
 *
 * 반대편 관계(`examples`)는 선언하지 않는다. 선언하면 include 대상이 되고, 그러면
 * Category 하나가 Example 전체를 끌고 나올 수 있다.
 */
export const CATEGORY_SERIALIZER: ResourceSerializer<Category> = {
  type: 'exampleCategories',
  attributes: {
    name: (category) => category.name,
    createdAt: (category) => category.createdAt.toISOString(),
    updatedAt: (category) => category.updatedAt.toISOString(),
  },
  relationships: {},
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_CATEGORY_SERIALIZER: ErasedSerializer = {
  type: CATEGORY_SERIALIZER.type,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Category)) {
      throw new TypeError('Category 엔티티가 아니다');
    }
    return serializeResource(CATEGORY_SERIALIZER, entity);
  },
};
