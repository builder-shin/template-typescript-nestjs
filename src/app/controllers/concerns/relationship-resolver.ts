import { In } from 'typeorm';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { parseLinkageInput } from '../../jsonapi/document.js';
import type { RelationshipInput, ResourceIdentifier } from '../../jsonapi/document.js';
import { JsonApiError } from '../../jsonapi/errors.js';
import { normalizeUuid } from '../../jsonapi/scalar-grammar.js';
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

/**
 * 기본키 컬럼이 uuid인 엔티티의 id 모양.
 *
 * 같은 모양을 `jsonapi/filter.ts`도 따로 갖는다. 그쪽은 필터 값이 uuid 형식인지를
 * 보고 여기는 이 id가 행을 가리킬 수 있는지를 봐서, 합치면 해석 계층이 필터 계층에
 * 의존하게 된다. 한쪽을 고칠 일이 생기면 다른 쪽도 함께 본다.
 */
export function normalizeModelId(
  manager: EntityManager,
  model: EntityTarget<ObjectLiteral>,
  id: string,
): string {
  const [primary] = manager.dataSource.getMetadata(model).primaryColumns;
  return primary?.type === 'uuid' ? normalizeUuid(id) : id;
}

/**
 * 이 id가 그 엔티티의 행을 가리킬 수 있는 모양인지 본다.
 *
 * uuid 컬럼에 uuid가 아닌 문자열을 넣으면 PostgreSQL이 22P02로 죽고 500이 나간다.
 * 가리킬 수 없는 id는 없는 자원을 가리킨 것이므로, 물어보기 전에 걸러 404로 답한다.
 *
 * 경로 id와 linkage id가 같은 규칙을 쓰게 하려고 export한다 — `crud-actions.ts`의
 * `assertIdShape`가 이 함수를 쓴다. 두 곳이 각자 판정하면 한쪽만 고쳐지는 날이 온다.
 */
export function canIdentify(
  manager: EntityManager,
  model: EntityTarget<ObjectLiteral>,
  id: string,
): boolean {
  try {
    normalizeModelId(manager, model, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * "이 이름은 쓸 수 있는 관계가 아니다" 오류를 만든다.
 *
 * `resolveRelationships`가 스키마에 없는 관계 이름을 만났을 때 쓰고, 관계 스키마가
 * 아예 없는 자원(`auth.controller.ts`의 네 라우트)이 관계를 통째로 거부할 때도 같은
 * 함수를 쓴다 — 두 자리가 각자 오류를 만들면 문자열이 갈릴 수 있고, 그러면 같은
 * 실수가 자원마다 다른 오류로 보인다.
 */
export function unwritableRelationshipError(name: string): JsonApiError {
  return new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
    source: { pointer: `/data/relationships/${name}` },
  });
}

/** 식별자 목록을 행으로 바꾸고, 없는 것이 있으면 던진다. */
async function loadAll(
  manager: EntityManager,
  rule: RelationshipWriteRule,
  identifiers: readonly ResourceIdentifier[],
  pointer: string,
): Promise<ObjectLiteral[]> {
  const ids: string[] = [];
  for (const [index, identifier] of identifiers.entries()) {
    const resourcePointer = rule.cardinality === 'many' ? `${pointer}/${String(index)}` : pointer;
    if (identifier.type !== rule.type) {
      throw new JsonApiError('TYPE_MISMATCH', { source: { pointer: `${resourcePointer}/type` } });
    }
    const itemPointer =
      rule.cardinality === 'many' ? `${pointer}/${String(index)}/id` : `${pointer}/id`;
    if (!canIdentify(manager, rule.model, identifier.id))
      throw new JsonApiError('RELATIONSHIP_RESOURCE_NOT_FOUND', {
        source: { pointer: itemPointer },
      });
    const id = normalizeModelId(manager, rule.model, identifier.id);
    if (ids.includes(id))
      throw new JsonApiError('INVALID_JSONAPI_DOCUMENT', { source: { pointer: itemPointer } });
    ids.push(id);
  }
  if (ids.length === 0) {
    return [];
  }
  const rows = await manager.find(rule.model, { where: { id: In(ids) } });
  return ids.map((id, index) => {
    const row = rows.find((candidate) => Reflect.get(candidate, 'id') === id);
    if (row === undefined)
      throw new JsonApiError('RELATIONSHIP_RESOURCE_NOT_FOUND', {
        source: {
          pointer: rule.cardinality === 'many' ? `${pointer}/${String(index)}/id` : `${pointer}/id`,
        },
      });
    return row;
  });
}

/**
 * 관계 하나의 linkage를 해석한다.
 *
 * 관계 라우트가 직접 쓰는 진입점이기도 하다 — 그쪽은 관계가 하나뿐이라 `pointer`가
 * `/data`다.
 *
 * `input`이 `unknown`인 이유: 관계 라우트는 검증되지 않은 요청 본문을 그대로 넘긴다.
 * `parseLinkageInput`이 이미 `unknown`을 받아 `data` 멤버 존재부터 식별자 모양까지
 * 전부 보므로, 부르는 쪽이 같은 검사를 미리 하면 같은 오류를 두 곳에서 만들게 된다.
 */
export async function resolveOne(
  manager: EntityManager,
  rule: RelationshipWriteRule,
  input: unknown,
  pointer: string,
): Promise<ObjectLiteral | ObjectLiteral[] | null> {
  const linkage = parseLinkageInput(input, {
    expectedType: rule.type,
    cardinality: rule.cardinality,
    pointer,
    deferModelSemantics: true,
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
      throw unwritableRelationshipError(name);
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
