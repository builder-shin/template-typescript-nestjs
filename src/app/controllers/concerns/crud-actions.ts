import { Inject, UseGuards } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource, EntityManager, ObjectLiteral } from 'typeorm';
import type { RelationshipInput } from '../../jsonapi/document.js';
import { JsonApiError } from '../../jsonapi/errors.js';
import type { HeaderWritableResponse } from '../../jsonapi/media-type.js';
import { JsonApiNegotiationGuard } from '../../jsonapi/negotiation.js';
import { buildCursorLinks, buildOffsetLinks, sliceProbe } from '../../jsonapi/pagination.js';
import { executeList } from '../../jsonapi/query-compiler.js';
import {
  assertNoQueryParameters,
  parseQuery,
  parseRelatedCollectionQuery,
  parseSingleResourceQuery,
} from '../../jsonapi/query.js';
import { collectIncluded, serializeResource } from '../../serializers/serializer.js';
import type { ResourceObject } from '../../serializers/serializer.js';
import type { CrudDeclaration } from './crud-base.js';
import { collectionDocument, singleDocument } from './documents.js';
import type { CollectionDocument, LinkageDocument, SingleDocument } from './documents.js';
import { applyAttributes, parseWriteDocument } from './document-parsing.js';
import { assertResourcePath } from './jsonapi-controller.js';
import { resolveOne, resolveRelationships } from './relationship-resolver.js';
import type { ResolvedLinkage } from './relationship-resolver.js';
import { RESOURCE_ALIAS, registerRoutes } from './route-registrar.js';
import type { RelationshipDelegates } from './route-registrar.js';

/**
 * 선언만으로 CRUD와 관계 라우트를 만드는 mixin 팩토리.
 *
 * 컨트롤러에는 선언만 둔다 — 자원별 service 계층을 만들지 않는다는 스펙 4장의 규칙이
 * 여기서 지켜진다. 도메인 개입이 필요하면 `beforeSave`/`afterSave`/`beforeDestroy`
 * 훅을 쓰고, 훅으로 안 되는 자원은 이 mixin을 쓰지 않는 편이 낫다.
 *
 * 팩토리가 만든 클래스에는 `emitDecoratorMetadata`가 `design:paramtypes`를 붙여 주지
 * 않으므로 생성자 주입을 `Inject`로 직접 선언한다(계획의 사전 검증 결과 참고).
 */

type QueryRecord = Readonly<Record<string, string | readonly string[] | undefined>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CrudActions<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
>(declaration: CrudDeclaration<T, C, U>): Type<object> {
  const { model, serializer, queryPolicy, relationshipsSchema } = declaration;
  const declaredRelationships = Object.keys(serializer.relationships);

  if (declaration.enableUpsert === true && declaration.replaceSchema === undefined) {
    throw new TypeError('enableUpsert를 켰으면 replaceSchema를 선언해야 한다');
  }

  class CrudActionsHost implements RelationshipDelegates {
    constructor(readonly dataSource: DataSource) {
      // 팩토리 시점에는 `@Controller`가 아직 붙지 않아 비교할 경로가 없다.
      // 생성자로 옮겨 부트스트랩에서 터지게 한다(`jsonapi-controller.ts` 참고).
      assertResourcePath(this.constructor, serializer.resourcePath);
    }

    /** `self` 링크와 `Location`의 기준. 생성자가 이미 존재를 확인했다. */
    private get basePath(): string {
      const path = serializer.resourcePath;
      if (path === undefined) {
        throw new TypeError('resourcePath가 없다');
      }
      return path;
    }

    /**
     * 잘못된 모양의 id를 404로 바꾼다.
     *
     * 기본키가 uuid인데 uuid가 아닌 문자열이 오면 PostgreSQL이 문법 오류를 내고
     * 500이 나간다. 없는 자원을 물은 것이므로 404가 맞는 답이다.
     */
    private assertIdShape(manager: EntityManager, id: string): void {
      const [primary] = manager.dataSource.getMetadata(model).primaryColumns;
      if (primary?.type === 'uuid' && !UUID_PATTERN.test(id)) {
        throw this.notFound(id);
      }
    }

    private notFound(id: string): JsonApiError {
      return new JsonApiError('RESOURCE_NOT_FOUND', {
        detail: `no "${serializer.type}" resource with id "${id}"`,
      });
    }

    /** 자원 하나를 include와 함께 읽는다. 없으면 404. */
    private async findOne(
      manager: EntityManager,
      id: string,
      include: readonly string[],
    ): Promise<T> {
      this.assertIdShape(manager, id);
      const builder = manager
        .getRepository(model)
        .createQueryBuilder(RESOURCE_ALIAS)
        .where(`${RESOURCE_ALIAS}.id = :id`, { id });
      for (const path of include) {
        const definition = serializer.relationships[path];
        if (definition === undefined) {
          throw new TypeError(`선언되지 않은 관계 경로다: ${path}`);
        }
        builder.leftJoinAndSelect(
          `${RESOURCE_ALIAS}.${definition.eagerLoad}`,
          definition.eagerLoad,
        );
      }
      const entity = await builder.getOne();
      if (entity === null) {
        throw this.notFound(id);
      }
      return entity;
    }

    /** 해석을 마친 linkage를 엔티티에 옮긴다. */
    private applyLinkage(entity: T, linkage: ResolvedLinkage): void {
      for (const [name, value] of Object.entries(linkage.toOne)) {
        Reflect.set(entity, name, value);
      }
      for (const [name, value] of Object.entries(linkage.toMany)) {
        Reflect.set(entity, name, value);
      }
    }

    async index(query: QueryRecord): Promise<CollectionDocument> {
      const parsed = parseQuery(query, queryPolicy, declaredRelationships);
      const builder = this.dataSource.getRepository(model).createQueryBuilder(RESOURCE_ALIAS);
      const result = await executeList(builder, RESOURCE_ALIAS, parsed, serializer);
      const data = result.items.map((item) => serializeResource(serializer, item));
      const included = collectIncluded(serializer, result.items, parsed.include);
      const links =
        parsed.page.mode === 'offset'
          ? buildOffsetLinks(this.basePath, query, parsed.page, result.hasMore, result.totalCount)
          : buildCursorLinks(
              this.basePath,
              query,
              parsed.page,
              result.firstCursor,
              result.lastCursor,
              result.hasMore,
            );
      return collectionDocument(data, included, links, result.totalCount);
    }

    async show(id: string, query: QueryRecord): Promise<SingleDocument> {
      const include = parseSingleResourceQuery(query, queryPolicy, declaredRelationships);
      const entity = await this.findOne(this.dataSource.manager, id, include);
      return singleDocument(
        serializeResource(serializer, entity),
        collectIncluded(serializer, [entity], include),
      );
    }

    async create(body: unknown, response: HeaderWritableResponse): Promise<SingleDocument> {
      const parsed = await parseWriteDocument(body, declaration.createSchema, {
        expectedType: serializer.type,
      });

      const saved = await this.dataSource.transaction(async (manager) => {
        const entity = manager.getRepository(model).create();
        applyAttributes(entity, parsed.attributes, parsed.presentKeys);
        this.applyLinkage(
          entity,
          await resolveRelationships(manager, relationshipsSchema, parsed.relationships),
        );
        await declaration.beforeSave?.(entity, manager);
        const stored = await manager.getRepository(model).save(entity);
        await declaration.afterSave?.(stored, manager);
        return stored;
      });

      response.setHeader('Location', `${this.basePath}/${saved.id}`);

      // 저장 뒤에 다시 읽는다. DB 기본값(`status`)과 생성 시각은 저장 시점에야 정해지고,
      // 관계는 요청이 보낸 것만 되읽어 응답의 linkage가 실제 상태와 맞게 한다.
      const reloaded = await this.findOne(
        this.dataSource.manager,
        saved.id,
        Object.keys(parsed.relationships),
      );
      return singleDocument(serializeResource(serializer, reloaded), []);
    }

    async update(id: string, body: unknown): Promise<SingleDocument> {
      const parsed = await parseWriteDocument(body, declaration.updateSchema, {
        expectedType: serializer.type,
        expectedId: id,
      });

      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, Object.keys(parsed.relationships));
        // 보낸 필드만 바꾼다. 스펙 7.1의 부분 갱신이 여기서 지켜진다.
        applyAttributes(entity, parsed.attributes, parsed.presentKeys);
        this.applyLinkage(
          entity,
          await resolveRelationships(manager, relationshipsSchema, parsed.relationships),
        );
        await declaration.beforeSave?.(entity, manager);
        const stored = await manager.getRepository(model).save(entity);
        await declaration.afterSave?.(stored, manager);
      });

      const reloaded = await this.findOne(
        this.dataSource.manager,
        id,
        Object.keys(parsed.relationships),
      );
      return singleDocument(serializeResource(serializer, reloaded), []);
    }

    async destroy(id: string): Promise<void> {
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, []);
        await declaration.beforeDestroy?.(entity, manager);
        await manager.getRepository(model).remove(entity);
      });
    }

    /** 관계 규칙을 꺼낸다. 라우트가 있는 관계는 반드시 규칙이 있다. */
    private ruleFor(name: string): (typeof relationshipsSchema)[string] {
      const rule = relationshipsSchema[name];
      if (rule === undefined) {
        throw new TypeError(`쓰기로 열리지 않은 관계다: ${name}`);
      }
      return rule;
    }

    private linkageLinks(id: string, name: string): { self: string; related: string } {
      return {
        self: `${this.basePath}/${id}/relationships/${name}`,
        related: `${this.basePath}/${id}/${name}`,
      };
    }

    async showRelationshipFor(name: string, id: string): Promise<LinkageDocument> {
      const entity = await this.findOne(this.dataSource.manager, id, [name]);
      const object = serializeResource(serializer, entity);
      const relationship = object.relationships[name];
      if (relationship === undefined) {
        throw new TypeError(`시리얼라이저가 선언하지 않은 관계다: ${name}`);
      }
      return { data: relationship.data ?? null, links: this.linkageLinks(id, name) };
    }

    async replaceRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const resolved = await resolveOne(manager, rule, readLinkage(body), '/data');
        Reflect.set(entity, name, resolved);
        await manager.getRepository(model).save(entity);
      });
    }

    async addToRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const incoming = await resolveOne(manager, rule, readLinkage(body), '/data');
        if (!Array.isArray(incoming)) {
          throw new TypeError(`to-many 관계가 아니다: ${name}`);
        }
        const merged = readLoadedRows(entity, name);
        const present = new Set(merged.map(identityOf));
        for (const row of incoming) {
          const rowId = identityOf(row);
          if (!present.has(rowId)) {
            present.add(rowId);
            merged.push(row);
          }
        }
        Reflect.set(entity, name, merged);
        await manager.getRepository(model).save(entity);
      });
    }

    async removeFromRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const outgoing = await resolveOne(manager, rule, readLinkage(body), '/data');
        if (!Array.isArray(outgoing)) {
          throw new TypeError(`to-many 관계가 아니다: ${name}`);
        }
        const removed = new Set(outgoing.map(identityOf));
        const existing = readLoadedRows(entity, name);
        Reflect.set(
          entity,
          name,
          existing.filter((entry) => !removed.has(identityOf(entry))),
        );
        await manager.getRepository(model).save(entity);
      });
    }

    async showRelatedFor(name: string, id: string, query: QueryRecord): Promise<unknown> {
      const rule = this.ruleFor(name);
      const entity = await this.findOne(this.dataSource.manager, id, [name]);
      const definition = serializer.relationships[name];
      if (definition === undefined) {
        throw new TypeError(`시리얼라이저가 선언하지 않은 관계다: ${name}`);
      }
      const target = definition.target();
      const value: unknown = definition.read(entity);

      if (rule.cardinality === 'one') {
        // 스펙 8.2: to-one 관계 URL은 모든 조회 파라미터를 거부한다.
        assertNoQueryParameters(query);
        if (value === null || value === undefined) {
          return { data: null };
        }
        return { data: target.serializeUnknown(value) };
      }

      // 스펙 8.2: to-many는 `page[number]`/`page[size]`만 받고 총 개수를 언제나 낸다.
      const page = parseRelatedCollectionQuery(query, queryPolicy);
      const rows: unknown[] = Array.isArray(value) ? value : [];
      // 관계 컬렉션은 한 자원에 매달린 것이라 크기가 제한적이다. 별도 질의로 자르는
      // 대신 이미 읽어 온 배열에서 자른다 — 조인 한 번으로 끝나고 총 개수도 공짜다.
      const start = ((page.number ?? 1) - 1) * page.size;
      const windowed = rows.slice(start, start + page.size + 1);
      const probed = sliceProbe(windowed, page);
      const data: ResourceObject[] = probed.items.map((row) => target.serializeUnknown(row));
      const links = buildOffsetLinks(
        `${this.basePath}/${id}/${name}`,
        query,
        page,
        probed.hasMore,
        rows.length,
      );
      return collectionDocument(data, [], links, rows.length);
    }
  }

  Inject(getDataSourceToken())(CrudActionsHost, undefined, 0);
  // 협상 가드는 클래스 전체에 붙는다 — 이 컨트롤러의 모든 라우트가 JSON:API다.
  UseGuards(JsonApiNegotiationGuard)(CrudActionsHost);
  registerRoutes(CrudActionsHost, declaration);

  return CrudActionsHost;
}

/**
 * 이미 eager-load된 to-many 관계 배열을 복사해 꺼낸다. 로드되지 않았으면 빈 배열이다.
 *
 * `Array.isArray`가 좁혀 주는 타입은 `any[]`이므로 `unknown[]`으로 받아 `any`가 번지지
 * 않게 막는다 — `serializer.ts`가 linkage를 읽을 때와 같은 이유다. 원본을 그대로 쓰지
 * 않고 복사하는 것은 TypeORM이 들고 있는 배열을 제자리에서 바꾸지 않기 위해서다.
 */
function readLoadedRows(entity: object, name: string): unknown[] {
  const current: unknown = Reflect.get(entity, name);
  const rows: unknown[] = Array.isArray(current) ? current : [];
  return [...rows];
}

/**
 * 관계 행의 id를 읽는다.
 *
 * `ObjectLiteral`의 인덱스 시그니처는 `any`를 흘리므로 프로퍼티를 직접 집지 않고
 * 여기서 한 번만 좁힌다. id가 없는 행은 DB에서 온 엔티티가 아니라는 뜻이라 조립 실수다.
 */
function identityOf(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || !('id' in row)) {
    throw new TypeError('관계 행에 id가 없다');
  }
  return row.id;
}

/**
 * 관계 라우트 본문이 `data` 멤버를 가졌는지 본다.
 *
 * `data`의 **값**은 보지 않는다 — 식별자 모양과 cardinality는 `resolveOne` 안의
 * `parseLinkageInput`이 다시 검증하고 400을 낸다. `document.ts`의 같은 이름 헬퍼가
 * 자원 문서에 대해 하는 것과 같은 얕은 검사이고, 그래서 캐스트 없이 좁힐 수 있다.
 */
function isRelationshipInput(body: unknown): body is RelationshipInput {
  return typeof body === 'object' && body !== null && 'data' in body;
}

/** 관계 라우트 본문을 `resolveOne`의 입력으로 만든다. `data`가 없으면 문서 오류다. */
function readLinkage(body: unknown): RelationshipInput {
  if (!isRelationshipInput(body)) {
    throw new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
      source: { pointer: '/data' },
      detail: 'the document requires a "data" member',
    });
  }
  return body;
}
