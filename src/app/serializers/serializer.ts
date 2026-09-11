import type { ResourceIdentifier } from '../jsonapi/document.js';

/**
 * 자원의 공개 표현 선언.
 *
 * 이 계층은 "무엇을 밖으로 보이는가"만 소유한다. 요청 값 검증(schemas/)이나 SQL filter
 * 해석(jsonapi/)은 하지 않는다. 엔티티에 컬럼을 추가해도 여기에 적지 않으면 응답에
 * 나가지 않는다 — 공개 표면이 저장 구조를 따라 조용히 넓어지는 것을 막는 장치다.
 */

/** 관계의 cardinality. */
export type RelationshipCardinality = 'one' | 'many';

/** JSON:API 관계 객체. */
export interface RelationshipObject {
  /** 부모 자원에 `resourcePath`가 없으면 만들 수 없으므로 선택이다. */
  readonly links?: { readonly self: string; readonly related: string };
  readonly data?: ResourceIdentifier | readonly ResourceIdentifier[] | null;
}

/** JSON:API 자원 객체. */
export interface ResourceObject {
  readonly type: string;
  readonly id: string;
  readonly attributes: Record<string, unknown>;
  readonly relationships?: Record<string, RelationshipObject>;
  readonly links?: { readonly self: string };
}

/**
 * 타입을 지운 시리얼라이저.
 *
 * 관계 대상과 `included` 조립에 쓴다. `ResourceSerializer<T>`를 그대로 담으면 attribute
 * 읽기 함수가 파라미터 반공변 위치라 `ResourceSerializer<Category>`를
 * `ResourceSerializer<{ id: string }>`으로 넓힐 수 없다. 그래서 선언하는 쪽이
 * `serializeUnknown`에서 자기 엔티티인지 직접 좁혀 주고, 그 대가로 이 저장소에서
 * 캐스트를 하나도 쓰지 않는다.
 */
export interface ErasedSerializer {
  readonly type: string;
  readonly resourcePath?: string;
  serializeUnknown(entity: unknown): ResourceObject;
}

/** 시리얼라이저가 선언하는 관계 하나. */
export interface RelationshipDefinition<T> {
  readonly cardinality: RelationshipCardinality;
  /** `include`가 지정됐을 때 eager-load할 TypeORM 관계 경로. */
  readonly eagerLoad: string;
  /**
   * 엔티티에서 관계 값을 읽는다.
   *
   * `undefined`는 "로드하지 않았다", `null`은 "없다"로 갈라진다. 리플렉션으로
   * 프로퍼티를 문자열로 집지 않는 이유는 그 경로가 `any`를 흘려 `strictTypeChecked`를
   * 통과하지 못하기 때문이기도 하고, 선언이 곧 계약이어야 하기 때문이기도 하다.
   */
  readonly read: (entity: T) => unknown;
  /** 대상 시리얼라이저. 순환 import를 피하려 지연 참조로 받는다. */
  readonly target: () => ErasedSerializer;
}

/** 자원 하나의 공개 표현 선언. */
export interface ResourceSerializer<T extends { id: string }> {
  readonly type: string;
  /**
   * `self` 링크와 `Location` 헤더의 기준 경로. 앞에 슬래시가 있고 끝에는 없다.
   *
   * Phase 4의 `CrudActions`가 `@Controller` 경로와 이 값을 비교해 어긋나면 조립 시점에
   * 던진다. 두 값이 갈라지면 잘못된 링크가 조용히 나간다.
   *
   * **선택인 이유**: 스펙 16장의 공개 API 표면에 자신을 다시 가리키는 라우트가 없는
   * 자원은 가리킬 URL 자체가 없다. 링크를 지어내면 클라이언트가 404를 따라가므로,
   * 그런 자원은 `links`를 아예 내지 않는다. 예시와 근거는
   * `src/app/serializers/AGENTS.md`의 "`resourcePath`가 선택인 이유" 참고.
   */
  readonly resourcePath?: string;
  readonly selfLink?: (entity: T) => string;
  readonly attributes: Readonly<Record<string, (entity: T) => unknown>>;
  readonly relationships: Readonly<Record<string, RelationshipDefinition<T>>>;
}

function identifierOf(type: string, value: unknown): ResourceIdentifier {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    throw new TypeError('관계 값이 엔티티가 아니다');
  }
  const id = value.id;
  if (typeof id !== 'string') {
    throw new TypeError('관계 값의 id가 문자열이 아니다');
  }
  return { type, id };
}

function linkage(
  cardinality: RelationshipCardinality,
  type: string,
  value: unknown,
): ResourceIdentifier | ResourceIdentifier[] | null {
  if (cardinality === 'one') {
    return value === null ? null : identifierOf(type, value);
  }
  if (!Array.isArray(value)) {
    throw new TypeError('to-many 관계 값이 배열이 아니다');
  }
  // `Array.isArray`가 좁혀 주는 타입은 `any[]`다. `unknown[]`으로 받아 `any`가
  // 더 번지지 않게 막는다.
  const entries: unknown[] = value;
  return entries.map((entry) => identifierOf(type, entry));
}

/** 엔티티 하나를 JSON:API 자원 객체로 만든다. */
export function serializeResource<T extends { id: string }>(
  serializer: ResourceSerializer<T>,
  entity: T,
): ResourceObject {
  const attributes: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(serializer.attributes)) {
    attributes[name] = read(entity);
  }

  const path = serializer.resourcePath;
  const self =
    serializer.selfLink?.(entity) ?? (path === undefined ? undefined : `${path}/${entity.id}`);

  const relationships: Record<string, RelationshipObject> = {};
  for (const [name, definition] of Object.entries(serializer.relationships)) {
    const links =
      self === undefined
        ? undefined
        : { self: `${self}/relationships/${name}`, related: `${self}/${name}` };
    const value = definition.read(entity);
    const object: RelationshipObject =
      value === undefined
        ? { ...(links === undefined ? {} : { links }) }
        : {
            ...(links === undefined ? {} : { links }),
            data: linkage(definition.cardinality, definition.target().type, value),
          };
    relationships[name] = object;
  }

  return {
    type: serializer.type,
    id: entity.id,
    attributes,
    ...(Object.keys(relationships).length === 0 ? {} : { relationships }),
    ...(self === undefined ? {} : { links: { self } }),
  };
}

/**
 * `include`가 지정한 관계 대상을 모아 `included` 배열을 만든다.
 *
 * 같은 자원은 한 번만 담는다 — JSON:API는 `included`에 같은 (type, id)가 두 번
 * 나오는 것을 금지한다. 경로는 이미 `include.ts`가 시리얼라이저와 정책 양쪽에
 * 대조해 통과시킨 것들이다.
 */
export function collectIncluded<T extends { id: string }>(
  serializer: ResourceSerializer<T>,
  entities: readonly T[],
  includePaths: readonly string[],
): ResourceObject[] {
  const seen = new Set<string>();
  const included: ResourceObject[] = [];

  for (const path of includePaths) {
    const definition = serializer.relationships[path];
    if (definition === undefined) {
      throw new TypeError(`선언되지 않은 관계 경로다: ${path}`);
    }
    const target = definition.target();

    for (const entity of entities) {
      const value = definition.read(entity);
      if (value === undefined || value === null) {
        continue;
      }
      const related: unknown[] = Array.isArray(value) ? value : [value];
      for (const item of related) {
        const object = target.serializeUnknown(item);
        const key = `${object.type}:${object.id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        included.push(object);
      }
    }
  }

  return included;
}
