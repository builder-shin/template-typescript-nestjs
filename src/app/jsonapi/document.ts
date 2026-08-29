import { JsonApiError } from './errors.js';

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
  /** 클라이언트가 생성한 id를 받을지. 기본은 거부. */
  readonly allowClientGeneratedId?: boolean;
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

function invalidDocument(pointer?: string, detail?: string): JsonApiError {
  return new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
    source: pointer === undefined ? undefined : { pointer },
    detail,
  });
}

/** 하나의 linkage 항목을 검사한다. */
function readIdentifier(value: unknown, expectedType: string, pointer: string): ResourceIdentifier {
  if (!isPlainObject(value)) {
    throw invalidDocument(pointer, 'resource identifier must be an object');
  }
  const type = value.type;
  if (typeof type !== 'string' || type === '') {
    throw invalidDocument(`${pointer}/type`, 'resource identifier requires a type');
  }
  if (type !== expectedType) {
    throw new JsonApiError('TYPE_MISMATCH', {
      source: { pointer: `${pointer}/type` },
      detail: `expected type "${expectedType}" but received "${type}"`,
    });
  }
  const id = value.id;
  if (typeof id !== 'string' || id === '') {
    throw invalidDocument(`${pointer}/id`, 'resource identifier requires an id');
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
    throw invalidDocument(undefined, 'request body must be a JSON object');
  }

  const data = body.data;
  if (!isPlainObject(data)) {
    throw invalidDocument('/data', 'the document requires a single resource object in "data"');
  }

  const type = data.type;
  if (typeof type !== 'string' || type === '') {
    throw invalidDocument('/data/type', 'the resource object requires a type');
  }
  if (type !== options.expectedType) {
    throw new JsonApiError('TYPE_MISMATCH', {
      source: { pointer: '/data/type' },
      detail: `expected type "${options.expectedType}" but received "${type}"`,
    });
  }

  let id: string | undefined;
  if (data.id !== undefined) {
    if (typeof data.id !== 'string' || data.id === '') {
      throw invalidDocument('/data/id', 'the resource id must be a non-empty string');
    }
    id = data.id;
    if (options.expectedId !== undefined) {
      if (id !== options.expectedId) {
        throw new JsonApiError('ID_MISMATCH', {
          source: { pointer: '/data/id' },
          detail: `expected id "${options.expectedId}" but received "${id}"`,
        });
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
      throw invalidDocument('/data/attributes', '"attributes" must be an object');
    }
    attributes = data.attributes;
  }

  const relationships: Record<string, RelationshipInput> = {};
  if (data.relationships !== undefined) {
    if (!isPlainObject(data.relationships)) {
      throw invalidDocument('/data/relationships', '"relationships" must be an object');
    }
    for (const [name, value] of Object.entries(data.relationships)) {
      if (!isRelationshipInput(value)) {
        throw invalidDocument(
          `/data/relationships/${name}`,
          'a relationship requires a "data" member',
        );
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
  readonly expectedType: string;
  readonly cardinality: 'one' | 'many';
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
): ResourceIdentifier | ResourceIdentifier[] | null {
  if (!isPlainObject(body)) {
    throw invalidDocument(undefined, 'request body must be a JSON object');
  }
  if (!('data' in body)) {
    throw invalidDocument('/data', 'the document requires a "data" member');
  }

  const data = body.data;

  if (options.cardinality === 'one') {
    if (data === null) {
      return null;
    }
    if (Array.isArray(data)) {
      throw invalidDocument('/data', 'a to-one relationship requires a single resource identifier');
    }
    return readIdentifier(data, options.expectedType, '/data');
  }

  if (!Array.isArray(data)) {
    throw invalidDocument(
      '/data',
      'a to-many relationship requires an array of resource identifiers',
    );
  }
  return data.map((entry, index) =>
    readIdentifier(entry, options.expectedType, `/data/${String(index)}`),
  );
}
