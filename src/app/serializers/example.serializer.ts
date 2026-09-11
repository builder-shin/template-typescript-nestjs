import { serializeTimestamp } from '../jsonapi/exact-timestamps.js';
import { Example } from '../models/example.entity.js';
import { ERASED_CATEGORY_SERIALIZER } from './category.serializer.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';
import { ERASED_TAG_SERIALIZER } from './tag.serializer.js';

/**
 * Example의 공개 표현.
 *
 * `categoryId`는 attribute가 아니다. 내부 FK는 `category` 관계로만 노출한다 —
 * 스펙 7.3이 입력에 대해 같은 규칙을 정하고, 출력도 같은 이유로 갈라놓는다. FK를
 * attribute로 열면 클라이언트가 관계 라우트 대신 그 필드를 쓰기 시작하고, 그때부터
 * 관계 계약이 두 벌이 된다.
 *
 * 날짜는 여기서 ISO 8601 문자열로 바꾼다. `JSON.stringify`가 우연히 같은 결과를
 * 내지만, 표현 형식의 소유자는 시리얼라이저여야 저장 타입이 바뀌어도 응답이 흔들리지
 * 않는다.
 */
export const EXAMPLE_SERIALIZER: ResourceSerializer<Example> = {
  type: 'examples',
  resourcePath: '/api/v1/examples',
  attributes: {
    title: (example) => example.title,
    description: (example) => example.description,
    status: (example) => example.status,
    score: (example) => example.score,
    createdAt: (example) => serializeTimestamp(example.createdAt),
    updatedAt: (example) => serializeTimestamp(example.updatedAt),
  },
  relationships: {
    category: {
      cardinality: 'one',
      eagerLoad: 'category',
      read: (example) => example.category,
      target: () => ERASED_CATEGORY_SERIALIZER,
    },
    tags: {
      cardinality: 'many',
      eagerLoad: 'tags',
      read: (example) => example.tags,
      target: () => ERASED_TAG_SERIALIZER,
    },
  },
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_EXAMPLE_SERIALIZER: ErasedSerializer = {
  type: EXAMPLE_SERIALIZER.type,
  resourcePath: EXAMPLE_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Example)) {
      throw new TypeError('Example 엔티티가 아니다');
    }
    return serializeResource(EXAMPLE_SERIALIZER, entity);
  },
};
