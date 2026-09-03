import type { ResourceIdentifier } from '../../jsonapi/document.js';
import type { PaginationLinks } from '../../jsonapi/pagination.js';
import type { ResourceObject } from '../../serializers/serializer.js';

/**
 * 응답 문서 조립.
 *
 * 다섯 액션과 관계 액션이 모두 같은 모양을 만든다. 각자 객체 리터럴을 쓰면
 * `included`가 빌 때 빈 배열을 내는 곳과 멤버를 생략하는 곳이 갈린다 — 응답 모양이
 * 라우트마다 다른 것은 계약이 아니라 사고다.
 */

/** 자원 하나를 담은 문서. */
export interface SingleDocument {
  readonly data: ResourceObject;
  readonly included?: readonly ResourceObject[];
}

/** 자원 목록을 담은 문서. */
export interface CollectionDocument {
  readonly data: readonly ResourceObject[];
  readonly included?: readonly ResourceObject[];
  readonly links: PaginationLinks;
  readonly meta?: { readonly totalCount: number };
}

/** 관계의 linkage 문서. */
export interface LinkageDocument {
  readonly data: ResourceIdentifier | readonly ResourceIdentifier[] | null;
  readonly links: { readonly self: string; readonly related: string };
}

/** 자원 하나를 문서로 만든다. `included`가 비면 멤버를 생략한다. */
export function singleDocument(
  data: ResourceObject,
  included: readonly ResourceObject[],
): SingleDocument {
  return { data, ...(included.length === 0 ? {} : { included }) };
}

/**
 * 자원 목록을 문서로 만든다.
 *
 * `totalCount`는 `undefined`("세지 않았다")와 `0`("없다")을 가른다. `0`을 falsy로
 * 흘리면 두 뜻이 하나로 뭉개진다.
 */
export function collectionDocument(
  data: readonly ResourceObject[],
  included: readonly ResourceObject[],
  links: PaginationLinks,
  totalCount: number | undefined,
): CollectionDocument {
  return {
    data,
    ...(included.length === 0 ? {} : { included }),
    links,
    ...(totalCount === undefined ? {} : { meta: { totalCount } }),
  };
}
