import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import type { ValidationError } from 'class-validator';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { JsonApiError, JsonApiErrors } from '../jsonapi/errors.js';
import type { RelationshipCardinality } from '../serializers/serializer.js';

/**
 * 쓰기 DTO 검증.
 *
 * 참조 구현의 Pydantic `extra="forbid"`에 해당하는 것이 `forbidNonWhitelisted`다.
 * 선언되지 않은 필드를 조용히 버리면 오타 난 필드가 무시된 채 저장되고 클라이언트는
 * 반영됐다고 읽는다 — 그 조용한 실패를 거부로 바꾼다.
 *
 * 실패는 언제나 `JsonApiErrors`로 던진다. 하나만 틀렸을 때도 집합으로 던져야
 * 잡는 쪽이 "하나인가 여럿인가"로 분기하지 않는다.
 */

/** `ValidationError` 하나를 JSON:API 오류로 옮긴다. */
function toJsonApiError(failure: ValidationError, path: readonly string[]): JsonApiError {
  const constraints = failure.constraints ?? {};
  const [detail] = Object.values(constraints);
  return new JsonApiError('VALIDATION_ERROR', {
    // 중첩 필드는 부모까지 담아야 클라이언트가 고칠 곳을 찾는다. class-validator는
    // 배열 원소의 property를 인덱스 문자열로 주므로 `tags/0/name` 같은 경로도
    // 그대로 올바른 JSON Pointer가 된다.
    source: { pointer: `/data/attributes/${path.join('/')}` },
    // 제약이 여러 개 걸린 필드는 첫 메시지만 싣는다. 나머지는 같은 필드를 고치면
    // 함께 사라지므로, 한 필드에 여러 줄을 내는 것보다 필드당 한 줄이 읽기 쉽다.
    detail: detail ?? `"${path.join('.')}" is invalid`,
  });
}

/**
 * 중첩 검증 오류를 평평하게 편다.
 *
 * `path`에 조상 필드 이름을 쌓아 내려간다 — 이것이 없으면 자식의 오류가 부모를 잃은
 * 경로를 가리켜 클라이언트가 없는 필드를 고치려 든다.
 */
function flatten(
  failures: readonly ValidationError[],
  path: readonly string[] = [],
): JsonApiError[] {
  const errors: JsonApiError[] = [];
  for (const failure of failures) {
    const here = [...path, failure.property];
    if (failure.constraints !== undefined) {
      errors.push(toJsonApiError(failure, here));
    }
    if (failure.children !== undefined && failure.children.length > 0) {
      errors.push(...flatten(failure.children, here));
    }
  }
  return errors;
}

/**
 * attributes를 쓰기 스키마로 검증하고 인스턴스를 돌려준다.
 *
 * `plainToInstance`가 `@Transform`을 먼저 적용하므로, 저장 형식으로의 변환
 * (ISO 문자열 → `Date` 등)은 검증 이전에 끝나 있다.
 */
export async function validateAttributes<D extends object>(
  schema: ClassConstructor<D>,
  attributes: Record<string, unknown>,
): Promise<D> {
  const instance = plainToInstance(schema, attributes);
  const failures = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  const errors = flatten(failures);
  if (errors.length > 0) {
    throw new JsonApiErrors(errors);
  }
  return instance;
}

/** 쓸 수 있는 관계 하나의 선언. */
export interface RelationshipWriteRule {
  readonly cardinality: RelationshipCardinality;
  /** 이 관계가 받는 자원의 JSON:API type. linkage의 type과 대조한다. */
  readonly type: string;
  /** linkage의 id로 실제 행을 찾을 때 쓰는 엔티티. */
  readonly model: EntityTarget<ObjectLiteral>;
}

/**
 * 자원이 쓰기로 여는 관계 목록.
 *
 * 스펙 6.3의 "시리얼라이저 관계 키와 관계 스키마 필드의 교집합"에서 뒤쪽이 이것이다.
 * 그 교집합이 지배하는 것은 **쓰기** 라우트다 — 여기 없는 관계는 mutation 라우트를
 * 얻지 못하고 읽기 전용이 되지만, 시리얼라이저가 선언한 이상 `GET` 두 개는 열린다
 * (`route-registrar.ts` 참고). 링크는 나가는데 라우트가 없으면 응답이 404를 광고한다.
 */
export type RelationshipWriteSchema = Readonly<Record<string, RelationshipWriteRule>>;
