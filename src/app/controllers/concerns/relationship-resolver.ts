import { In } from 'typeorm';
import type { EntityManager, ObjectLiteral } from 'typeorm';
import { parseLinkageInput } from '../../jsonapi/document.js';
import type { RelationshipInput, ResourceIdentifier } from '../../jsonapi/document.js';
import { JsonApiError } from '../../jsonapi/errors.js';
import type { RelationshipWriteRule, RelationshipWriteSchema } from '../../schemas/write-schema.js';

/**
 * linkage를 실제 행으로 해석한다.
 *
 * 입력은 언제나 `ResourceIdentifier`뿐이다 — 내부 FK를 공개 입력으로 만들지 않는다는
 * 스펙 7.3의 규칙이고, 그래서 여기서 id를 행으로 바꾸는 단계가 필요하다.
 *
 * 하나라도 없으면 전체를 거부한다. 일부만 붙이면 클라이언트가 보낸 집합과 저장된
 * 집합이 갈라지는데, 응답만 봐서는 그 차이를 알 수 없다.
 */

/** 해석을 마친 관계. 입력에 없던 관계는 여기에도 없다. */
export interface ResolvedLinkage {
  readonly toOne: Record<string, ObjectLiteral | null>;
  readonly toMany: Record<string, ObjectLiteral[]>;
}

/** 식별자 목록을 행으로 바꾸고, 없는 것이 있으면 던진다. */
async function loadAll(
  manager: EntityManager,
  rule: RelationshipWriteRule,
  identifiers: readonly ResourceIdentifier[],
  pointer: string,
): Promise<ObjectLiteral[]> {
  const ids = [...new Set(identifiers.map((identifier) => identifier.id))];
  if (ids.length === 0) {
    return [];
  }
  const rows = await manager.find(rule.model, { where: { id: In(ids) } });
  if (rows.length !== ids.length) {
    throw new JsonApiError('RELATIONSHIP_RESOURCE_NOT_FOUND', {
      source: { pointer },
      detail: `one or more "${rule.type}" resources do not exist`,
    });
  }
  return rows;
}

/**
 * 관계 하나의 linkage를 해석한다.
 *
 * 관계 라우트가 직접 쓰는 진입점이기도 하다 — 그쪽은 관계가 하나뿐이라 `pointer`가
 * `/data`다.
 */
export async function resolveOne(
  manager: EntityManager,
  rule: RelationshipWriteRule,
  input: RelationshipInput,
  pointer: string,
): Promise<ObjectLiteral | ObjectLiteral[] | null> {
  const linkage = parseLinkageInput(input, {
    expectedType: rule.type,
    cardinality: rule.cardinality,
    pointer,
  });

  if (linkage === null) {
    return null;
  }
  if (Array.isArray(linkage)) {
    return loadAll(manager, rule, linkage, pointer);
  }
  const [row] = await loadAll(manager, rule, [linkage], pointer);
  if (row === undefined) {
    throw new JsonApiError('RELATIONSHIP_RESOURCE_NOT_FOUND', { source: { pointer } });
  }
  return row;
}

/** 자원 문서의 `relationships`를 통째로 해석한다. */
export async function resolveRelationships(
  manager: EntityManager,
  schema: RelationshipWriteSchema,
  inputs: Readonly<Record<string, RelationshipInput>>,
): Promise<ResolvedLinkage> {
  const toOne: Record<string, ObjectLiteral | null> = {};
  const toMany: Record<string, ObjectLiteral[]> = {};

  for (const [name, input] of Object.entries(inputs)) {
    const rule = schema[name];
    if (rule === undefined) {
      throw new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
        source: { pointer: `/data/relationships/${name}` },
        detail: `"${name}" is not a writable relationship`,
      });
    }

    const resolved = await resolveOne(manager, rule, input, `/data/relationships/${name}/data`);

    if (rule.cardinality === 'many') {
      if (!Array.isArray(resolved)) {
        throw new TypeError(`to-many 관계가 배열이 아닌 결과를 냈다: ${name}`);
      }
      toMany[name] = resolved;
      continue;
    }
    if (Array.isArray(resolved)) {
      throw new TypeError(`to-one 관계가 배열 결과를 냈다: ${name}`);
    }
    toOne[name] = resolved;
  }

  return { toOne, toMany };
}
