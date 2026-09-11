import { JsonApiError, JsonApiErrors } from './errors.js';

/**
 * JSON:API 요청 문서의 구조 판정.
 *
 * 이 파일은 "본문이 JSON:API 문서인가"만 본다. 필드값이 도메인 규칙에 맞는지는
 * 보지 않는다 — 그것은 쓰기 스키마(class-validator)의 몫이고, 오류 코드도
 * `VALIDATION_ERROR`로 갈라진다. 두 책임을 한 곳에 두면 400과 422의 경계가 흐려진다.
 */

/** JSON:API 자원 식별자. linkage의 최소 단위다. */
export interface ResourceIdentifier {
  readonly type: string;
  readonly id: string;
}

/** 자원 문서의 `relationships` 한 항목. */
export interface RelationshipInput {
  readonly data: ResourceIdentifier | readonly ResourceIdentifier[] | null;
}

/** 파싱을 마친 자원 입력. */
export interface ParsedResourceInput {
  readonly type: string;
  readonly id: string | undefined;
  readonly attributes: Record<string, unknown>;
  readonly relationships: Record<string, RelationshipInput>;
  /**
   * 요청이 실제로 보낸 attribute 키.
   *
   * PATCH가 "보내지 않은 필드"와 "`null`로 보낸 필드"를 구분하는 근거다.
   * `plainToInstance`는 이 정보를 지우므로 변환 전에 잡아 둔다.
   */
  readonly presentKeys: ReadonlySet<string>;
}

/** `parseResourceInput` 옵션. */
export interface ParseResourceOptions {
  /** 이 라우트가 받는 자원 타입. 문서의 `type`과 다르면 `TYPE_MISMATCH`. */
  readonly expectedType: string;
  /** 경로에서 온 id. 문서가 id를 보냈고 이 값과 다르면 `ID_MISMATCH`. */
  readonly expectedId?: string;
  readonly requireId?: boolean;
  /** 클라이언트가 생성한 id를 받을지. 기본은 거부. */
  readonly allowClientGeneratedId?: boolean;
  readonly relationships?: Readonly<Record<string, { readonly cardinality: 'one' | 'many' }>>;
}

export function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Schema failures are collected before semantic type/id or database checks. */
export function collectResourceValidation(
  body: unknown,
  options: ParseResourceOptions,
): JsonApiError[] {
  const errors: JsonApiError[] = [];
  const add = (pointer?: string): void => {
    errors.push(
      new JsonApiError('VALIDATION_ERROR', {
        source: pointer === undefined ? undefined : { pointer },
      }),
    );
  };
  if (!isPlainObject(body)) {
    add();
    return errors;
  }
  const data = body.data;
  if (!isPlainObject(data)) add('/data');
  else {
    if (typeof data.type !== 'string') add('/data/type');
    const updating = options.expectedId !== undefined;
    if ((updating || options.requireId === true) && !('id' in data)) add('/data/id');
    else if ('id' in data && typeof data.id !== 'string') add('/data/id');
    if (
      'attributes' in data
        ? !isPlainObject(data.attributes)
        : !updating || options.requireId === true
    )
      add('/data/attributes');
    if ('relationships' in data) {
      if (!isPlainObject(data.relationships) || Object.keys(data.relationships).length === 0)
        add('/data/relationships');
      else
        for (const [name, relationship] of Object.entries(data.relationships)) {
          const pointer = `/data/relationships/${pointerSegment(name)}`;
          if (options.relationships !== undefined && !Object.hasOwn(options.relationships, name)) {
            add(pointer);
            continue;
          }
          if (!isPlainObject(relationship)) {
            add(pointer);
            continue;
          }
          if (!('data' in relationship)) add(`${pointer}/data`);
          else {
            const cardinality = options.relationships?.[name]?.cardinality;
            const linkage = relationship.data;
            if (
              (cardinality === 'many' && !Array.isArray(linkage)) ||
              (cardinality === 'one' && Array.isArray(linkage))
            )
              add(`${pointer}/data`);
            else if (Array.isArray(linkage))
              linkage.forEach((entry: unknown, index: number) =>
                errors.push(...identifierValidation(entry, `${pointer}/data/${String(index)}`)),
              );
            else if (linkage !== null)
              errors.push(...identifierValidation(linkage, `${pointer}/data`));
          }
          for (const key of Object.keys(relationship))
            if (key !== 'data') add(`${pointer}/${pointerSegment(key)}`);
        }
    }
    for (const key of Object.keys(data))
      if (!['type', 'id', 'attributes', 'relationships'].includes(key))
        add(`/data/${pointerSegment(key)}`);
  }
  for (const key of Object.keys(body)) if (key !== 'data') add(`/${pointerSegment(key)}`);
  return errors;
}

function identifierValidation(value: unknown, pointer: string): JsonApiError[] {
  const errors: JsonApiError[] = [];
  const add = (path: string): void => {
    errors.push(new JsonApiError('VALIDATION_ERROR', { source: { pointer: path } }));
  };
  if (!isPlainObject(value)) {
    add(pointer);
    return errors;
  }
  for (const key of ['type', 'id']) if (typeof value[key] !== 'string') add(`${pointer}/${key}`);
  if ('meta' in value && !isPlainObject(value.meta)) add(`${pointer}/meta`);
  for (const key of Object.keys(value))
    if (!['type', 'id', 'meta'].includes(key)) add(`${pointer}/${pointerSegment(key)}`);
  return errors;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `relationships`의 한 항목이 `RelationshipInput` 형태인지 본다.
 *
 * `data` 멤버의 존재만 확인한다 — 그 값이 실제로 유효한 식별자(들)인지는 보지
 * 않는다. `unknown`을 좁히는 타입 프레디케이트이므로 이후 `value.data`는
 * 캐스트 없이 `RelationshipInput['data']`로 취급된다.
 */
function isRelationshipInput(value: unknown): value is RelationshipInput {
  return isPlainObject(value) && 'data' in value;
}

function invalidDocument(pointer?: string): JsonApiError {
  return new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
    source: pointer === undefined ? undefined : { pointer },
  });
}

/** 하나의 linkage 항목을 검사한다. */
function readIdentifier(
  value: unknown,
  expectedType: string | undefined,
  pointer: string,
): ResourceIdentifier {
  if (!isPlainObject(value)) {
    throw invalidDocument(pointer);
  }
  for (const key of Object.keys(value)) {
    if (!['type', 'id', 'meta'].includes(key)) {
      throw new JsonApiError('VALIDATION_ERROR', { source: { pointer: `${pointer}/${key}` } });
    }
  }
  const type = value.type;
  if (typeof type !== 'string') {
    throw invalidDocument(`${pointer}/type`);
  }
  if (expectedType !== undefined && type !== expectedType) {
    throw new JsonApiError('TYPE_MISMATCH', { source: { pointer: `${pointer}/type` } });
  }
  const id = value.id;
  if (typeof id !== 'string') {
    throw invalidDocument(`${pointer}/id`);
  }
  return { type, id };
}

/**
 * 자원 생성·수정 요청 문서를 파싱한다.
 *
 * 성공하면 attributes와 relationships를 원본 그대로 넘긴다. 값 검증은 하지 않는다.
 */
export function parseResourceInput(
  body: unknown,
  options: ParseResourceOptions,
): ParsedResourceInput {
  if (!isPlainObject(body)) {
    throw invalidDocument(undefined);
  }

  const data = body.data;
  if (!isPlainObject(data)) {
    throw invalidDocument('/data');
  }

  const type = data.type;
  if (typeof type !== 'string') {
    throw invalidDocument('/data/type');
  }
  if (type !== options.expectedType) {
    throw new JsonApiError('TYPE_MISMATCH', { source: { pointer: '/data/type' } });
  }

  if (options.requireId && data.id === undefined) {
    throw new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/id' } });
  }
  let id: string | undefined;
  if (data.id !== undefined) {
    if (typeof data.id !== 'string') {
      throw invalidDocument('/data/id');
    }
    id = data.id;
    if (options.expectedId !== undefined) {
      if (id !== options.expectedId) {
        throw new JsonApiError('ID_MISMATCH', { source: { pointer: '/data/id' } });
      }
    } else if (options.allowClientGeneratedId !== true) {
      throw new JsonApiError('CLIENT_GENERATED_ID_UNSUPPORTED', {
        source: { pointer: '/data/id' },
      });
    }
  }

  let attributes: Record<string, unknown> = {};
  if (data.attributes !== undefined) {
    if (!isPlainObject(data.attributes)) {
      throw invalidDocument('/data/attributes');
    }
    attributes = data.attributes;
  }

  const relationships: Record<string, RelationshipInput> = {};
  if (data.relationships !== undefined) {
    if (!isPlainObject(data.relationships)) {
      throw invalidDocument('/data/relationships');
    }
    for (const [name, value] of Object.entries(data.relationships)) {
      if (!isRelationshipInput(value)) {
        throw invalidDocument(`/data/relationships/${name}`);
      }
      relationships[name] = { data: value.data };
    }
  }

  return {
    type,
    id,
    attributes,
    relationships,
    presentKeys: new Set(Object.keys(attributes)),
  };
}

/** `parseLinkageInput` 옵션. */
export interface ParseLinkageOptions {
  /** The ORM resolver validates type, normalized ID and duplicates together in input order. */
  readonly deferModelSemantics?: boolean;
  readonly expectedType: string;
  readonly cardinality: 'one' | 'many';
  /**
   * 오류 `source.pointer`의 기준. 기본은 관계 라우트의 본문을 가리키는 `/data`다.
   *
   * 자원 문서 안의 `relationships`를 파싱할 때는 그 관계를 가리켜야 한다
   * (`/data/relationships/tags/data`). pointer가 틀리면 클라이언트가 어느 필드를
   * 고쳐야 하는지 알 수 없다.
   */
  readonly pointer?: string;
}

/**
 * 관계 라우트의 linkage 문서를 파싱한다.
 *
 * to-one은 식별자 하나 또는 `null`(해제), to-many는 식별자 배열(빈 배열은 전체 해제)이다.
 * 내부 FK를 공개 입력으로 만들지 않기 위해 `ResourceIdentifier`만 받는다.
 */
export function parseLinkageInput(
  body: unknown,
  options: ParseLinkageOptions,
  beforeSemantics?: () => void,
): ResourceIdentifier | ResourceIdentifier[] | null {
  const pointer = options.pointer ?? '/data';

  const failures: JsonApiError[] = [];
  const add = (path?: string): void => {
    failures.push(
      new JsonApiError('VALIDATION_ERROR', {
        source: path === undefined ? undefined : { pointer: path },
      }),
    );
  };
  if (!isPlainObject(body)) add();
  else {
    if (!('data' in body)) add(pointer);
    else if (options.cardinality === 'many') {
      if (!Array.isArray(body.data)) add(pointer);
      else
        body.data.forEach((entry: unknown, index: number) =>
          failures.push(...identifierValidation(entry, `${pointer}/${String(index)}`)),
        );
    } else if (body.data !== null) failures.push(...identifierValidation(body.data, pointer));
    for (const key of Object.keys(body)) if (key !== 'data') add(`/${pointerSegment(key)}`);
  }
  if (failures.length > 0) throw new JsonApiErrors(failures);
  beforeSemantics?.();

  if (!isPlainObject(body)) {
    throw invalidDocument(undefined);
  }
  if (!('data' in body)) {
    throw invalidDocument(pointer);
  }

  const data = body.data;

  if (options.cardinality === 'one') {
    if (data === null) {
      return null;
    }
    if (Array.isArray(data)) {
      throw invalidDocument(pointer);
    }
    return readIdentifier(
      data,
      options.deferModelSemantics === true ? undefined : options.expectedType,
      pointer,
    );
  }

  if (!Array.isArray(data)) {
    throw invalidDocument(pointer);
  }
  const identifiers = data.map((entry, index) =>
    readIdentifier(
      entry,
      options.deferModelSemantics === true ? undefined : options.expectedType,
      `${pointer}/${String(index)}`,
    ),
  );
  if (options.deferModelSemantics === true) return identifiers;
  const seen = new Set<string>();
  for (const [index, identifier] of identifiers.entries()) {
    if (seen.has(identifier.id)) throw invalidDocument(`${pointer}/${String(index)}/id`);
    seen.add(identifier.id);
  }
  return identifiers;
}
