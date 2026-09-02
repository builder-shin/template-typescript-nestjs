import {
  Body,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CanActivate, Type } from '@nestjs/common';
import type { ObjectLiteral } from 'typeorm';
import type { RelationshipWriteRule } from '../../schemas/write-schema.js';
import type { CrudDeclaration } from './crud-base.js';

/**
 * 프로토타입에 라우트를 붙인다.
 *
 * 정적 액션은 이름과 경로가 고정이라 그대로 데코레이터를 함수로 적용한다. 관계
 * 라우트는 개수가 선언에 따라 달라지므로 프로토타입에 델리게이트 메서드를 만들고
 * 거기에 적용한다 — 스펙 6.3이 검증한 방식이고, 이래야 OpenAPI에 관계마다 개별
 * 경로가 노출된다.
 *
 * 등록 대상이 읽기와 쓰기에서 갈린다.
 *
 * - **읽기**(`GET :id/relationships/<rel>`, `GET :id/<rel>`)는 시리얼라이저가 선언한
 *   모든 관계에 만든다. `serializeResource`가 선언한 관계마다 `self`/`related` 링크를
 *   내보내므로, 여기서 교집합만 열면 응답이 404로 가는 링크를 광고하게 된다.
 * - **쓰기**(`PATCH`, to-many의 `POST`/`DELETE`)는 `relationshipsSchema`에도 있는
 *   관계에만 만든다. 스펙 6.3의 교집합 규칙이 지배하는 것은 이쪽이다 — "이름이
 *   어긋나면 쓰기 관계 라우트가 조용히 사라진다"가 그 근거 문장이다.
 *
 * 그래서 쓰기 스키마에 없는 관계는 **읽기 전용**이 된다. 두 규칙 모두 라우트 조립
 * 테스트가 고정한다.
 */

/** 질의 빌더의 별칭. 정책의 property가 이 별칭 뒤에 붙는다. */
export const RESOURCE_ALIAS = 'resource';

/**
 * 값이 동적 메서드를 얹을 수 있는 객체인지 본다.
 *
 * `Type<object>['prototype']`는 라이브러리 타입(`Function.prototype: any`) 탓에 `any`다.
 * 타입 프레디케이트로 좁혀야 `noUncheckedIndexedAccess` 아래에서 캐스트 없이
 * `Record<string, unknown>`으로 다룰 수 있다.
 */
function isPrototypeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 프로토타입 메서드에 데코레이터를 적용한다. 없으면 조립 실수이므로 던진다. */
function decorate(
  proto: object,
  name: string,
  apply: (descriptor: PropertyDescriptor) => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  if (descriptor === undefined) {
    throw new TypeError(`프로토타입에 ${name}이(가) 없다`);
  }
  apply(descriptor);
}

/** 쓰기 메서드에만 가드를 붙인다. */
function guardWrites(
  proto: object,
  names: readonly string[],
  guards: readonly Type<CanActivate>[],
): void {
  if (guards.length === 0) {
    return;
  }
  for (const name of names) {
    decorate(proto, name, (descriptor) => {
      UseGuards(...guards)(proto, name, descriptor);
    });
  }
}

/** 선언을 읽어 라우트를 등록한다. */
export function registerRoutes<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
>(host: Type<object>, declaration: CrudDeclaration<T, C, U>): void {
  const prototype: unknown = host.prototype;
  if (!isPrototypeObject(prototype)) {
    throw new TypeError(`${host.name}의 prototype이 객체가 아니다`);
  }
  const proto = prototype;
  const writeMethods: string[] = ['create', 'update', 'destroy'];

  decorate(proto, 'index', (descriptor) => {
    Get()(proto, 'index', descriptor);
    Query()(proto, 'index', 0);
  });

  decorate(proto, 'show', (descriptor) => {
    Get(':id')(proto, 'show', descriptor);
    Param('id')(proto, 'show', 0);
    Query()(proto, 'show', 1);
  });

  decorate(proto, 'create', (descriptor) => {
    Post()(proto, 'create', descriptor);
    HttpCode(201)(proto, 'create', descriptor);
    Body()(proto, 'create', 0);
    // `Location` 헤더를 붙이려면 응답 객체가 필요하다. `passthrough`이므로 반환값은
    // 그대로 Nest가 직렬화한다.
    Res({ passthrough: true })(proto, 'create', 1);
  });

  decorate(proto, 'update', (descriptor) => {
    Patch(':id')(proto, 'update', descriptor);
    Param('id')(proto, 'update', 0);
    Body()(proto, 'update', 1);
  });

  decorate(proto, 'destroy', (descriptor) => {
    Delete(':id')(proto, 'destroy', descriptor);
    HttpCode(204)(proto, 'destroy', descriptor);
    Param('id')(proto, 'destroy', 0);
  });

  // 규칙이 없는 관계(= 쓰기 스키마에 없는 관계)는 읽기 라우트만 받는다.
  for (const name of Object.keys(declaration.serializer.relationships)) {
    registerRelationship(proto, name, declaration.relationshipsSchema[name], writeMethods);
  }

  guardWrites(proto, writeMethods, declaration.writeGuards ?? []);
}

/**
 * 관계 하나의 라우트를 프로토타입에 만든다.
 *
 * `rule`이 `undefined`면 쓰기 스키마에 없는 관계라는 뜻이고, 그때는 `GET` 두 개만
 * 만든다.
 */
function registerRelationship(
  proto: Record<string, unknown>,
  name: string,
  rule: RelationshipWriteRule | undefined,
  writeMethods: string[],
): void {
  const showName = `showRelationship$${name}`;
  proto[showName] = function showRelationship(this: RelationshipDelegates, id: string) {
    return this.showRelationshipFor(name, id);
  };
  decorate(proto, showName, (descriptor) => {
    Get(`:id/relationships/${name}`)(proto, showName, descriptor);
    Param('id')(proto, showName, 0);
  });

  const relatedName = `showRelated$${name}`;
  proto[relatedName] = function showRelated(
    this: RelationshipDelegates,
    id: string,
    query: Readonly<Record<string, string | readonly string[] | undefined>>,
  ) {
    return this.showRelatedFor(name, id, query);
  };
  decorate(proto, relatedName, (descriptor) => {
    Get(`:id/${name}`)(proto, relatedName, descriptor);
    Param('id')(proto, relatedName, 0);
    Query()(proto, relatedName, 1);
  });

  if (rule === undefined) {
    return;
  }

  const updateName = `updateRelationship$${name}`;
  proto[updateName] = function updateRelationship(
    this: RelationshipDelegates,
    id: string,
    body: unknown,
  ) {
    return this.replaceRelationshipFor(name, id, body);
  };
  decorate(proto, updateName, (descriptor) => {
    Patch(`:id/relationships/${name}`)(proto, updateName, descriptor);
    HttpCode(204)(proto, updateName, descriptor);
    Param('id')(proto, updateName, 0);
    Body()(proto, updateName, 1);
  });
  writeMethods.push(updateName);

  if (rule.cardinality === 'many') {
    const addName = `addRelationship$${name}`;
    proto[addName] = function addRelationship(
      this: RelationshipDelegates,
      id: string,
      body: unknown,
    ) {
      return this.addToRelationshipFor(name, id, body);
    };
    decorate(proto, addName, (descriptor) => {
      Post(`:id/relationships/${name}`)(proto, addName, descriptor);
      HttpCode(204)(proto, addName, descriptor);
      Param('id')(proto, addName, 0);
      Body()(proto, addName, 1);
    });
    writeMethods.push(addName);

    const removeName = `removeRelationship$${name}`;
    proto[removeName] = function removeRelationship(
      this: RelationshipDelegates,
      id: string,
      body: unknown,
    ) {
      return this.removeFromRelationshipFor(name, id, body);
    };
    decorate(proto, removeName, (descriptor) => {
      Delete(`:id/relationships/${name}`)(proto, removeName, descriptor);
      HttpCode(204)(proto, removeName, descriptor);
      Param('id')(proto, removeName, 0);
      Body()(proto, removeName, 1);
    });
    writeMethods.push(removeName);
  }
}

/**
 * 델리게이트가 호출하는 액션. `crud-actions.ts`의 호스트가 구현한다.
 *
 * 관계마다 라우트 메서드를 따로 만들되 본문은 하나로 모으기 위한 계약이다 — 관계가
 * 늘어도 실제 로직은 이 다섯 개뿐이다.
 */
export interface RelationshipDelegates {
  showRelationshipFor(name: string, id: string): Promise<unknown>;
  replaceRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  addToRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  removeFromRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  showRelatedFor(
    name: string,
    id: string,
    query: Readonly<Record<string, string | readonly string[] | undefined>>,
  ): Promise<unknown>;
}
