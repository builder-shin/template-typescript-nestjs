import type { CanActivate, Type } from '@nestjs/common';
import type { ClassConstructor } from 'class-transformer';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryPolicy } from '../../schemas/query-policy.js';
import type { RelationshipWriteSchema } from '../../schemas/write-schema.js';
import type { ResourceSerializer } from '../../serializers/serializer.js';

/**
 * 자원 컨트롤러가 선언하는 것의 전부.
 *
 * 이 묶음에 없는 것은 `CrudActions`가 알 수 없고, 알 수 없는 것은 하지 않는다.
 * 자원별 service 계층을 만들지 않는다는 스펙 4장의 규칙이 여기서 지켜진다 —
 * 도메인 개입이 필요하면 훅을 쓰고, 훅으로 안 되면 그 자원은 `CrudActions`를
 * 쓰지 않는 편이 낫다.
 */

/** 저장·삭제 전후에 끼어드는 자리. 선언하지 않으면 아무 일도 하지 않는다. */
export interface CrudHooks<T extends ObjectLiteral> {
  /**
   * 저장 직전. 파생 필드 계산처럼 같은 트랜잭션에서 끝나야 하는 일을 둔다.
   *
   * `PUT`(upsert)에서는 이 시점이 `POST`/`PATCH`와 다르다. `upsertRow`의
   * `INSERT ... ON CONFLICT`가 이 훅보다 **먼저** 실행되어 행을 이미 만들거나
   * 갱신해 둔 뒤에야 이 훅이 돈다 — `POST`는 그 반대로, 행이 아직 없을 때 돈다.
   * 같은 트랜잭션에서 개수를 세는 훅(예: "분류당 example 최대 N개")은 그래서
   * `PUT`에서만 자기 자신을 한 개 더 센다.
   */
  beforeSave?(entity: T, manager: EntityManager): Promise<void> | void;
  /** 저장 직후, 같은 트랜잭션 안. 여기서 던지면 저장도 함께 롤백된다. */
  afterSave?(entity: T, manager: EntityManager): Promise<void> | void;
  /** 삭제 직전, 같은 트랜잭션 안. */
  beforeDestroy?(entity: T, manager: EntityManager): Promise<void> | void;
}

/** `CrudActions`에 넘기는 선언. */
export interface CrudDeclaration<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
> extends CrudHooks<T> {
  readonly model: EntityTarget<T>;
  readonly serializer: ResourceSerializer<T>;
  /** `POST` 본문의 attributes 스키마. */
  readonly createSchema: ClassConstructor<C>;
  /** `PATCH` 본문의 attributes 스키마. 모든 필드가 선택이어야 한다. */
  readonly updateSchema: ClassConstructor<U>;
  /**
   * `PUT` 본문의 attributes 스키마. Phase 5의 upsert가 쓴다.
   *
   * `enableUpsert`가 참인데 이 값이 없으면 조립 시점에 던진다 — 라우트만 열리고
   * 검증이 비는 상태가 조용히 만들어지는 것을 막는다.
   */
  readonly replaceSchema?: ClassConstructor<object>;
  /**
   * 쓰기로 여는 관계.
   *
   * 여기 없는 관계는 읽기 전용이 된다 — 시리얼라이저가 선언했다면 `GET` 두 개는
   * 그대로 열리고 `PATCH`/`POST`/`DELETE`만 생기지 않는다. 반대로 시리얼라이저가
   * 선언하지 않은 이름을 여기 적으면 조립 시점에 던진다(`crud-actions.ts` 참고).
   */
  readonly relationshipsSchema: RelationshipWriteSchema;
  readonly queryPolicy: QueryPolicy;
  /** `PUT` 라우트를 열지. 기본은 열지 않는다. */
  readonly enableUpsert?: boolean;
  /**
   * 쓰기 메서드에만 붙는 가드.
   *
   * 읽기는 공개이고 쓰기는 인증을 요구한다는 스펙 16장의 구분이 여기서 갈린다.
   * Phase 6이 `JwtActiveUserGuard`를 여기에 넣는다.
   */
  readonly writeGuards?: readonly Type<CanActivate>[];
}
