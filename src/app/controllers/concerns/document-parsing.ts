import type { ClassConstructor } from 'class-transformer';
import {
  collectResourceValidation,
  parseResourceInput,
  pointerSegment,
} from '../../jsonapi/document.js';
import type { ParseResourceOptions, RelationshipInput } from '../../jsonapi/document.js';
import { validateAttributes } from '../../schemas/write-schema.js';
import { JsonApiError, JsonApiErrors } from '../../jsonapi/errors.js';

/**
 * 요청 문서 파싱과 부분 갱신 적용.
 *
 * **이 파일 하나가 `presentKeys`를 소유한다.** class-validator에는 Pydantic의
 * `MISSING` sentinel에 해당하는 것이 없어서, "보내지 않은 필드"와 "`null`로 보낸
 * 필드"를 가르는 유일한 근거는 `plainToInstance` 이전의 원본 키 집합이다. 액션이
 * 원본 본문을 다시 읽지 않는 이유가 그것이다 — 두 곳에서 읽으면 두 해석이 갈라진다.
 *
 * Schema and attribute failures are collected as 422 before semantic type/id checks.
 */

/** 검증을 마친 쓰기 요청. */
export interface ParsedWrite<D extends object> {
  readonly attributes: D;
  /** 요청이 실제로 보낸 attribute 키. 스키마 필드 목록이 아니다. */
  readonly presentKeys: ReadonlySet<string>;
  readonly relationships: Record<string, RelationshipInput>;
  readonly id: string | undefined;
}

/** 자원 쓰기 문서를 파싱하고 attributes를 스키마로 검증한다. */
export async function parseWriteDocument<D extends object>(
  body: unknown,
  schema: ClassConstructor<D>,
  options: ParseResourceOptions,
  beforeSemantics?: () => void,
): Promise<ParsedWrite<D>> {
  const errors = collectResourceValidation(body, options);
  const data = isRecord(body) && isRecord(body.data) ? body.data : undefined;
  let attributes: D | undefined;
  if (data && isRecord(data.attributes)) {
    try {
      attributes = await validateAttributes(schema, data.attributes);
    } catch (error) {
      if (!(error instanceof JsonApiErrors)) throw error;
      errors.push(...error.errors);
    }
  } else if (
    data &&
    data.attributes === undefined &&
    options.expectedId !== undefined &&
    options.requireId !== true
  ) {
    attributes = await validateAttributes(schema, {});
  }
  if (errors.length > 0) throw new JsonApiErrors(errors);
  if (
    options.expectedId !== undefined &&
    options.requireId !== true &&
    data &&
    !('attributes' in data) &&
    !('relationships' in data)
  ) {
    throw new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data' } });
  }
  beforeSemantics?.();
  const parsed = parseResourceInput(body, options);
  attributes ??= await validateAttributes(schema, parsed.attributes);
  return {
    attributes,
    presentKeys: parsed.presentKeys,
    relationships: parsed.relationships,
    id: parsed.id,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Auth documents have a literal type and only data.type/data.attributes. */
export async function parseAuthWriteDocument<D extends object>(
  body: unknown,
  schema: ClassConstructor<D>,
  expectedType: string,
): Promise<ParsedWrite<D>> {
  const errors: JsonApiError[] = [];
  const add = (pointer?: string): void => {
    errors.push(
      new JsonApiError('VALIDATION_ERROR', {
        source: pointer === undefined ? undefined : { pointer },
      }),
    );
  };
  let attributes: D | undefined;
  if (!isRecord(body)) add();
  else {
    if (!isRecord(body.data)) add('/data');
    else {
      const data = body.data;
      if (data.type !== expectedType) add('/data/type');
      if (!isRecord(data.attributes)) add('/data/attributes');
      else {
        try {
          attributes = await validateAttributes(schema, data.attributes);
        } catch (error) {
          if (!(error instanceof JsonApiErrors)) throw error;
          errors.push(...error.errors);
        }
      }
      for (const key of Object.keys(data))
        if (!['type', 'attributes'].includes(key)) add(`/data/${pointerSegment(key)}`);
    }
    for (const key of Object.keys(body)) if (key !== 'data') add(`/${pointerSegment(key)}`);
  }
  if (errors.length > 0) throw new JsonApiErrors(errors);
  if (attributes === undefined) throw new TypeError('Validated auth attributes are missing');
  const rawAttributes =
    isRecord(body) && isRecord(body.data) && isRecord(body.data.attributes)
      ? body.data.attributes
      : {};
  return {
    attributes,
    presentKeys: new Set(Object.keys(rawAttributes)),
    relationships: {},
    id: undefined,
  };
}

/**
 * 요청이 보낸 필드만 엔티티에 옮긴다.
 *
 * `Object.assign`을 쓰지 않는 이유: 스키마 인스턴스에는 보내지 않은 선택 필드가
 * `undefined`로 존재할 수 있고, 그것을 통째로 덮으면 PATCH가 전체 교체가 된다.
 *
 * `Reflect`로 읽고 쓰는 이유: 제네릭 객체의 문자열 키 접근은 인덱스 시그니처를
 * 요구하는데, 엔티티에 인덱스 시그니처를 붙이면 오타 난 프로퍼티가 타입 검사를
 * 통과하게 된다. 읽은 값은 곧바로 `unknown`으로 받아 `any`가 번지지 않게 막는다.
 */
export function applyAttributes(
  entity: object,
  attributes: object,
  presentKeys: ReadonlySet<string>,
): void {
  for (const key of presentKeys) {
    if (!(key in attributes)) {
      continue;
    }
    const value: unknown = Reflect.get(attributes, key);
    Reflect.set(entity, key, value);
  }
}
