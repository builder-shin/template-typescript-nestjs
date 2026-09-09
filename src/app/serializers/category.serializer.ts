import { Category } from '../models/category.entity.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';

/**
 * Category의 공개 표현.
 *
 * `resourcePath`는 `CategoriesController`의 `@Controller` 경로와 문자 단위로 같아야
 * 한다 — `assertResourcePath`가 부트스트랩에서 확인한다. JSON:API `type`
 * (`exampleCategories`)이 URL 경로(`/api/v1/categories`)와 다른 것은 의도된 결정이다.
 *
 * 반대편 관계(`examples`)는 선언하지 않는다. 선언하면 include 대상이 되고, 그러면
 * Category 하나가 Example 전체를 끌고 나올 수 있다.
 *
 * `attributes`는 **`name` 하나뿐이다.** 참조 자원은 선택기의 라벨로 쓰이는 자리라
 * 표시용 이름 말고는 소비자가 없고, 정본(FastAPI)·Rails 도 `name` 하나만 낸다.
 * 시각 둘을 더 내면 프론트엔드의 자원 선언(백엔드 정책을 손으로 옮긴 거울)이
 * 이 백엔드에서만 거짓이 된다.
 *
 * `createdAt`은 여전히 **정렬 키**다(`category.query-policy.ts`). 정렬 가능한 것과
 * 응답에 나가는 것은 다른 목록이다 - 여기서 지우는 것은 후자뿐이다.
 */
export const CATEGORY_SERIALIZER: ResourceSerializer<Category> = {
  type: 'exampleCategories',
  resourcePath: '/api/v1/categories',
  attributes: {
    name: (category) => category.name,
  },
  relationships: {},
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_CATEGORY_SERIALIZER: ErasedSerializer = {
  type: CATEGORY_SERIALIZER.type,
  resourcePath: CATEGORY_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Category)) {
      throw new TypeError('Category 엔티티가 아니다');
    }
    return serializeResource(CATEGORY_SERIALIZER, entity);
  },
};
