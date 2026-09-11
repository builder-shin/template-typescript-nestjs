import { JsonApiError, JsonApiErrors } from '../../src/app/jsonapi/errors.js';
import { parseLinkageInput, parseResourceInput } from '../../src/app/jsonapi/document.js';

/**
 * `toBeInstanceOf`는 Jest 매처일 뿐 TypeScript 타입 가드가 아니다 — 써도
 * `error`는 여전히 `unknown`으로 남아 이후 `.code`/`.source` 접근에 캐스트가
 * 필요해진다. 대신 `instanceof`로 직접 좁혀 캐스트 없이 좁혀진 타입을 쓴다.
 * (Jest 매처 방식으로 "단순화"하지 말 것 — 캐스트가 다시 필요해진다.)
 */
function expectJsonApiError(fn: () => unknown, code: string, pointer?: string): void {
  try {
    fn();
  } catch (caught) {
    const error = caught instanceof JsonApiErrors ? caught.errors[0] : caught;
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    expect(error.code).toBe(code);
    if (pointer !== undefined) {
      expect(error.source?.pointer).toBe(pointer);
    }
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

describe('parseResourceInput', () => {
  it('최소 문서를 파싱한다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', attributes: { title: 'a' } } },
      { expectedType: 'examples' },
    );
    expect(result.type).toBe('examples');
    expect(result.id).toBeUndefined();
    expect(result.attributes).toEqual({ title: 'a' });
    expect(result.relationships).toEqual({});
  });

  it('attributes의 키 집합을 presentKeys로 잡는다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', attributes: { title: 'a', body: null } } },
      { expectedType: 'examples' },
    );
    expect([...result.presentKeys].sort()).toEqual(['body', 'title']);
  });

  it('attributes가 없으면 presentKeys가 비어 있다', () => {
    const result = parseResourceInput({ data: { type: 'examples' } }, { expectedType: 'examples' });
    expect(result.presentKeys.size).toBe(0);
    expect(result.attributes).toEqual({});
  });

  it('null로 보낸 필드도 presentKeys에 들어간다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', attributes: { body: null } } },
      { expectedType: 'examples' },
    );
    expect(result.presentKeys.has('body')).toBe(true);
    expect(result.attributes.body).toBeNull();
  });

  it('관계를 파싱한다', () => {
    const result = parseResourceInput(
      {
        data: {
          type: 'examples',
          relationships: { category: { data: { type: 'categories', id: 'c1' } } },
        },
      },
      { expectedType: 'examples' },
    );
    expect(result.relationships.category).toEqual({ data: { type: 'categories', id: 'c1' } });
  });

  it('관계 항목이 객체가 아니면 /data/relationships/{name}을 가리킨다', () => {
    expectJsonApiError(
      () =>
        parseResourceInput(
          { data: { type: 'examples', relationships: { category: 'x' } } },
          { expectedType: 'examples' },
        ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/relationships/category',
    );
  });

  it('관계 항목에 data 멤버가 없으면 /data/relationships/{name}을 가리킨다', () => {
    expectJsonApiError(
      () =>
        parseResourceInput(
          { data: { type: 'examples', relationships: { category: {} } } },
          { expectedType: 'examples' },
        ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/relationships/category',
    );
  });

  it('본문이 객체가 아니면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () => parseResourceInput(null, { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
    );
    expectJsonApiError(
      () => parseResourceInput('x', { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
    );
    expectJsonApiError(
      () => parseResourceInput([], { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
    );
  });

  it('data 멤버가 없으면 /data를 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput({}, { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data',
    );
  });

  it('data가 객체가 아니면 /data를 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput({ data: [] }, { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data',
    );
  });

  it('type이 없으면 /data/type을 가리킨다', () => {
    expectJsonApiError(
      () => parseResourceInput({ data: {} }, { expectedType: 'examples' }),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/type',
    );
  });

  it('type이 다르면 TYPE_MISMATCH', () => {
    expectJsonApiError(
      () => parseResourceInput({ data: { type: 'articles' } }, { expectedType: 'examples' }),
      'TYPE_MISMATCH',
      '/data/type',
    );
  });

  it('attributes가 객체가 아니면 /data/attributes를 가리킨다', () => {
    expectJsonApiError(
      () =>
        parseResourceInput(
          { data: { type: 'examples', attributes: [] } },
          { expectedType: 'examples' },
        ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/attributes',
    );
  });

  it('relationships가 객체가 아니면 /data/relationships를 가리킨다', () => {
    expectJsonApiError(
      () =>
        parseResourceInput(
          { data: { type: 'examples', relationships: 'x' } },
          { expectedType: 'examples' },
        ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/relationships',
    );
  });

  it('기대 id와 다르면 ID_MISMATCH', () => {
    expectJsonApiError(
      () =>
        parseResourceInput(
          { data: { type: 'examples', id: 'other' } },
          { expectedType: 'examples', expectedId: 'mine' },
        ),
      'ID_MISMATCH',
      '/data/id',
    );
  });

  it('기대 id와 같으면 통과한다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', id: 'mine' } },
      { expectedType: 'examples', expectedId: 'mine' },
    );
    expect(result.id).toBe('mine');
  });

  it('기대 id가 있는데 문서에 id가 없으면 통과한다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples' } },
      { expectedType: 'examples', expectedId: 'mine' },
    );
    expect(result.id).toBeUndefined();
  });

  it('클라이언트 생성 id를 기본적으로 거부한다', () => {
    expectJsonApiError(
      () =>
        parseResourceInput({ data: { type: 'examples', id: 'c1' } }, { expectedType: 'examples' }),
      'CLIENT_GENERATED_ID_UNSUPPORTED',
      '/data/id',
    );
  });

  it('허용하면 클라이언트 생성 id를 받는다', () => {
    const result = parseResourceInput(
      { data: { type: 'examples', id: 'c1' } },
      { expectedType: 'examples', allowClientGeneratedId: true },
    );
    expect(result.id).toBe('c1');
  });

  it('id가 문자열이 아니면 INVALID_JSONAPI_DOCUMENT', () => {
    expectJsonApiError(
      () =>
        parseResourceInput(
          { data: { type: 'examples', id: 1 } },
          { expectedType: 'examples', allowClientGeneratedId: true },
        ),
      'INVALID_JSONAPI_DOCUMENT',
      '/data/id',
    );
  });
});

describe('parseLinkageInput', () => {
  it('to-one linkage를 파싱한다', () => {
    const result = parseLinkageInput(
      { data: { type: 'categories', id: 'c1' } },
      { expectedType: 'categories', cardinality: 'one' },
    );
    expect(result).toEqual({ type: 'categories', id: 'c1' });
  });

  it('to-one null linkage는 관계 해제를 뜻한다', () => {
    const result = parseLinkageInput(
      { data: null },
      { expectedType: 'categories', cardinality: 'one' },
    );
    expect(result).toBeNull();
  });

  it('to-many linkage를 파싱한다', () => {
    const result = parseLinkageInput(
      {
        data: [
          { type: 'tags', id: 't1' },
          { type: 'tags', id: 't2' },
        ],
      },
      { expectedType: 'tags', cardinality: 'many' },
    );
    expect(result).toEqual([
      { type: 'tags', id: 't1' },
      { type: 'tags', id: 't2' },
    ]);
  });

  it('to-many 빈 배열은 전체 해제를 뜻한다', () => {
    const result = parseLinkageInput({ data: [] }, { expectedType: 'tags', cardinality: 'many' });
    expect(result).toEqual([]);
  });

  it('to-many에 null을 주면 VALIDATION_ERROR', () => {
    expectJsonApiError(
      () => parseLinkageInput({ data: null }, { expectedType: 'tags', cardinality: 'many' }),
      'VALIDATION_ERROR',
      '/data',
    );
  });

  it('to-one에 배열을 주면 VALIDATION_ERROR', () => {
    expectJsonApiError(
      () => parseLinkageInput({ data: [] }, { expectedType: 'categories', cardinality: 'one' }),
      'VALIDATION_ERROR',
      '/data',
    );
  });

  it('linkage type이 다르면 TYPE_MISMATCH', () => {
    expectJsonApiError(
      () =>
        parseLinkageInput(
          { data: { type: 'articles', id: 'a1' } },
          { expectedType: 'categories', cardinality: 'one' },
        ),
      'TYPE_MISMATCH',
      '/data/type',
    );
  });

  it('to-many 항목의 type이 다르면 인덱스를 pointer에 담는다', () => {
    expectJsonApiError(
      () =>
        parseLinkageInput(
          {
            data: [
              { type: 'tags', id: 't1' },
              { type: 'articles', id: 'a1' },
            ],
          },
          { expectedType: 'tags', cardinality: 'many' },
        ),
      'TYPE_MISMATCH',
      '/data/1/type',
    );
  });

  it('linkage에 id가 없으면 VALIDATION_ERROR', () => {
    expectJsonApiError(
      () =>
        parseLinkageInput(
          { data: { type: 'categories' } },
          { expectedType: 'categories', cardinality: 'one' },
        ),
      'VALIDATION_ERROR',
      '/data/id',
    );
  });

  it('linkage 식별자가 객체가 아니면 VALIDATION_ERROR', () => {
    expectJsonApiError(
      () =>
        parseLinkageInput(
          { data: 'not-an-object' },
          { expectedType: 'categories', cardinality: 'one' },
        ),
      'VALIDATION_ERROR',
      '/data',
    );
  });

  it('linkage에 type이 없으면 VALIDATION_ERROR', () => {
    expectJsonApiError(
      () =>
        parseLinkageInput(
          { data: { id: 'c1' } },
          { expectedType: 'categories', cardinality: 'one' },
        ),
      'VALIDATION_ERROR',
      '/data/type',
    );
  });

  it('data 멤버가 없으면 VALIDATION_ERROR', () => {
    expectJsonApiError(
      () => parseLinkageInput({}, { expectedType: 'tags', cardinality: 'many' }),
      'VALIDATION_ERROR',
      '/data',
    );
  });

  it('본문이 객체가 아니면 VALIDATION_ERROR', () => {
    expectJsonApiError(
      () => parseLinkageInput(null, { expectedType: 'tags', cardinality: 'many' }),
      'VALIDATION_ERROR',
    );
  });

  it('pointer 기준을 바꿀 수 있다', () => {
    // 자원 문서 안의 relationships에서는 `/data`가 아니라 그 관계를 가리켜야 한다.
    let thrown: unknown;
    try {
      parseLinkageInput(
        { data: { type: 'others', id: 't1' } },
        { expectedType: 'tags', cardinality: 'one', pointer: '/data/relationships/tags/data' },
      );
    } catch (error) {
      thrown = error instanceof JsonApiErrors ? error.errors[0] : error;
    }
    if (!(thrown instanceof JsonApiError)) {
      throw new Error('JsonApiError가 던져지지 않았다');
    }
    expect(thrown.source).toEqual({ pointer: '/data/relationships/tags/data/type' });
  });

  it('배열 항목의 pointer도 기준을 따른다', () => {
    let thrown: unknown;
    try {
      parseLinkageInput(
        { data: [{ type: 'tags', id: 't1' }, { type: 'tags' }] },
        { expectedType: 'tags', cardinality: 'many', pointer: '/data/relationships/tags/data' },
      );
    } catch (error) {
      thrown = error instanceof JsonApiErrors ? error.errors[0] : error;
    }
    if (!(thrown instanceof JsonApiError)) {
      throw new Error('JsonApiError가 던져지지 않았다');
    }
    expect(thrown.source).toEqual({ pointer: '/data/relationships/tags/data/1/id' });
  });

  it('pointer를 주지 않으면 /data를 쓴다', () => {
    let thrown: unknown;
    try {
      parseLinkageInput(
        { data: { type: 'others', id: 't1' } },
        {
          expectedType: 'tags',
          cardinality: 'one',
        },
      );
    } catch (error) {
      thrown = error instanceof JsonApiErrors ? error.errors[0] : error;
    }
    if (!(thrown instanceof JsonApiError)) {
      throw new Error('JsonApiError가 던져지지 않았다');
    }
    expect(thrown.source).toEqual({ pointer: '/data/type' });
  });
});
