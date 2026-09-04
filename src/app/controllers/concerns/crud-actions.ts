import { Inject, UseGuards } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource, EntityManager, ObjectLiteral } from 'typeorm';
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
import { canIdentify, resolveOne, resolveRelationships } from './relationship-resolver.js';
import type { ResolvedLinkage } from './relationship-resolver.js';
import { RESOURCE_ALIAS, registerRoutes } from './route-registrar.js';
import type { RelationshipDelegates } from './route-registrar.js';
import { replacementValues, upsertRow } from './upsert-executor.js';
import { schemaProperties } from '../../schemas/write-schema.js';

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

export function CrudActions<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
>(declaration: CrudDeclaration<T, C, U>): Type<object> {
  const { model, serializer, queryPolicy } = declaration;
  const enableWrites = declaration.enableWrites !== false;
  const relationshipsSchema = declaration.relationshipsSchema ?? {};
  const declaredRelationships = Object.keys(serializer.relationships);

  // 쓰기 라우트를 여는 자원은 그 라우트가 검증할 스키마를 함께 선언해야 한다.
  // 라우트만 열리고 검증이 비는 상태가 조용히 만들어지는 것을 막는다 —
  // `enableUpsert`/`replaceSchema`가 같은 모양의 선례다.
  if (enableWrites && declaration.createSchema === undefined) {
    throw new TypeError('enableWrites가 참이면 createSchema를 선언해야 한다');
  }
  if (enableWrites && declaration.updateSchema === undefined) {
    throw new TypeError('enableWrites가 참이면 updateSchema를 선언해야 한다');
  }

  if (declaration.enableUpsert === true && declaration.replaceSchema === undefined) {
    throw new TypeError('enableUpsert를 켰으면 replaceSchema를 선언해야 한다');
  }

  // 같은 관계를 두 곳이 선언한다. 어긋나면 라우트는 to-many로 열리는데 해석은
  // to-one으로 도는 식이 되고, 그 사고는 요청이 들어와야 드러난다.
  //
  // 시리얼라이저에 없는 이름을 쓰기 스키마가 들고 있는 반대 방향도 여기서 잡는다.
  // 그 이름은 라우트를 얻지 못하지만 `POST` 본문의 `relationships`로는 들어올 수 있고,
  // 그러면 행을 **커밋한 뒤** 응답을 되읽는 단계에서 터져 성공한 쓰기가 500으로 나간다.
  for (const [name, rule] of Object.entries(relationshipsSchema)) {
    const declared = serializer.relationships[name];
    if (declared === undefined) {
      throw new TypeError(`쓰기 스키마의 관계 "${name}"을 시리얼라이저가 선언하지 않았다`);
    }
    if (declared.cardinality !== rule.cardinality) {
      throw new TypeError(
        `관계 "${name}"의 cardinality가 시리얼라이저(${declared.cardinality})와 쓰기 스키마(${rule.cardinality})에서 다르다`,
      );
    }
  }

  // 위 검사가 이미 존재를 확인했다. 지역 상수로 좁혀 두면 액션마다 `?? throw`를
  // 반복하지 않아도 되고, 좁힘의 근거가 검사 바로 아래 한 곳에 남는다.
  const createSchema = declaration.createSchema;
  const updateSchema = declaration.updateSchema;

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
     *
     * 판정은 `relationship-resolver.ts`가 linkage id에 쓰는 것과 같은 함수다 — 경로
     * id와 본문 id가 다른 규칙을 쓰면 한쪽만 고쳐지는 날이 온다.
     */
    private assertIdShape(manager: EntityManager, id: string): void {
      if (!canIdentify(manager, model, id)) {
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
      if (createSchema === undefined) {
        throw new TypeError('createSchema 없이 create 라우트가 등록됐다');
      }
      const parsed = await parseWriteDocument(body, createSchema, {
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
      if (updateSchema === undefined) {
        throw new TypeError('updateSchema 없이 update 라우트가 등록됐다');
      }
      const parsed = await parseWriteDocument(body, updateSchema, {
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

    /**
     * 자원을 통째로 교체하거나 만든다.
     *
     * 스펙 7.2: 같은 ID로 동시에 들어온 요청은 advisory 트랜잭션 잠금으로 직렬화되고,
     * 생성/교체 판정은 `INSERT ... ON CONFLICT`가 같은 문장에서 한다. 생성은 201 +
     * `Location`, 교체는 200이다.
     */
    async replace(
      id: string,
      body: unknown,
      response: HeaderWritableResponse & { status(code: number): unknown },
    ): Promise<SingleDocument> {
      const schema = declaration.replaceSchema;
      if (schema === undefined) {
        throw new TypeError('replaceSchema 없이 replace가 호출됐다');
      }

      const parsed = await parseWriteDocument(body, schema, {
        expectedType: serializer.type,
        expectedId: id,
      });

      const outcome = await this.dataSource.transaction(async (manager) => {
        this.assertIdShape(manager, id);

        const values = replacementValues(
          manager,
          model,
          parsed.attributes,
          parsed.presentKeys,
          schemaProperties(schema),
        );
        const { created } = await upsertRow(manager, model, id, values);

        const entity = await this.findOne(manager, id, []);
        const linkage = await resolveRelationships(
          manager,
          relationshipsSchema,
          parsed.relationships,
        );

        // 전체 교체이므로 보내지 않은 관계는 비운다. `PATCH`가 건드리지 않는 것과
        // 갈리는 지점이고, 스펙 15장이 "관계 reset"을 회귀 대상으로 지목한 곳이다.
        //
        // `in`이 아니라 `Object.hasOwn`이다 — `in`은 프로토타입 체인까지 본다.
        // `constructor`·`toString`·`valueOf` 같은 이름의 관계가 선언되면 `in`은 언제나
        // 참이 되어, 보내지 않았는데도 리셋 대상에서 빠진다.
        for (const [name, rule] of Object.entries(relationshipsSchema)) {
          if (Object.hasOwn(linkage.toOne, name) || Object.hasOwn(linkage.toMany, name)) {
            continue;
          }
          Reflect.set(entity, name, rule.cardinality === 'many' ? [] : null);
        }
        this.applyLinkage(entity, linkage);

        await declaration.beforeSave?.(entity, manager);
        const stored = await manager.getRepository(model).save(entity);
        await declaration.afterSave?.(stored, manager);

        // `create`/`update`와 달리 재조회도 이 트랜잭션 안에서 한다(의도적인 차이이니
        // "일관성 있게" 커밋 뒤로 옮기지 말 것). `pg_advisory_xact_lock`은 트랜잭션
        // 스코프라 커밋과 함께 풀린다 — 밖에서 읽으면 그 읽기는 잠금이 이미 풀린 다른
        // 커넥션에서 일어나고, "동일 ID 동시 요청을 직렬화한다"는 약속이 응답 본문까지는
        // 미치지 못하게 된다.
        const reloaded = await this.findOne(manager, id, Object.keys(parsed.relationships));
        return {
          created,
          document: singleDocument(serializeResource(serializer, reloaded), []),
        };
      });

      if (outcome.created) {
        response.setHeader('Location', `${this.basePath}/${id}`);
        response.status(201);
      }
      return outcome.document;
    }

    /**
     * 관계의 쓰기 규칙을 꺼낸다. 쓰기 델리게이트만 이것을 지난다.
     *
     * 읽기 라우트는 쓰기 스키마에 없는 관계에도 생기므로 여기를 부르지 않는다 —
     * 부르면 읽기 전용 관계가 500이 된다.
     */
    private ruleFor(name: string): (typeof relationshipsSchema)[string] {
      const rule = relationshipsSchema[name];
      if (rule === undefined) {
        throw new TypeError(`쓰기로 열리지 않은 관계다: ${name}`);
      }
      return rule;
    }

    async showRelationshipFor(name: string, id: string): Promise<LinkageDocument> {
      const entity = await this.findOne(this.dataSource.manager, id, [name]);
      const object = serializeResource(serializer, entity);
      const relationship = object.relationships[name];
      if (relationship === undefined) {
        throw new TypeError(`시리얼라이저가 선언하지 않은 관계다: ${name}`);
      }
      // 링크는 시리얼라이저가 만든 것을 그대로 쓴다. 같은 문자열을 여기서 다시
      // 조립하면 두 벌이 언젠가 갈리고, 갈린 쪽을 응답만 봐서는 알 수 없다.
      // `resourcePath`가 없는 시리얼라이저만 링크가 없는데 그런 자원은 라우트를
      // 갖지 못한다(생성자가 이미 확인했다) — 그래도 지어내지 않고 던진다.
      const links = relationship.links;
      if (links === undefined) {
        throw new TypeError(`관계 링크를 만들 수 없다: ${name}`);
      }
      return { data: relationship.data ?? null, links };
    }

    async replaceRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const resolved = await resolveOne(manager, rule, body, '/data');
        Reflect.set(entity, name, resolved);
        await manager.getRepository(model).save(entity);
      });
    }

    async addToRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const incoming = await resolveOne(manager, rule, body, '/data');
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
        const outgoing = await resolveOne(manager, rule, body, '/data');
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
      const entity = await this.findOne(this.dataSource.manager, id, [name]);
      // cardinality를 쓰기 규칙이 아니라 시리얼라이저에서 읽는다. 이 라우트는 쓰기로
      // 열리지 않은 관계에도 생기므로(`route-registrar.ts` 참고) 쓰기 규칙을 요구하면
      // 읽기 전용 관계가 500이 된다.
      const definition = serializer.relationships[name];
      if (definition === undefined) {
        throw new TypeError(`시리얼라이저가 선언하지 않은 관계다: ${name}`);
      }
      const target = definition.target();
      const value: unknown = definition.read(entity);

      if (definition.cardinality === 'one') {
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
