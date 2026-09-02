import {
  ERROR_CATALOG,
  ERROR_CODES,
  JsonApiError,
  JsonApiErrors,
  catalogEntry,
} from '../../src/app/jsonapi/errors.js';

describe('오류 카탈로그', () => {
  it('스펙이 정한 24개 코드를 모두 가진다', () => {
    expect(ERROR_CODES).toHaveLength(24);
  });

  it('참조 구현과 같은 코드 집합을 가진다', () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        'AUTHENTICATION_REQUIRED',
        'CLIENT_GENERATED_ID_UNSUPPORTED',
        'EMAIL_ALREADY_REGISTERED',
        'HTTP_ERROR',
        'ID_MISMATCH',
        'INTERNAL_SERVER_ERROR',
        'INVALID_CREDENTIALS',
        'INVALID_FILTER',
        'INVALID_INCLUDE',
        'INVALID_JSONAPI_DOCUMENT',
        'INVALID_PAGE',
        'INVALID_QUERY_PARAMETER',
        'INVALID_SORT',
        'INVALID_TOKEN',
        'NOT_ACCEPTABLE',
        'RELATIONSHIP_RESOURCE_NOT_FOUND',
        'RESOURCE_CONFLICT',
        'RESOURCE_NOT_FOUND',
        'TOKEN_EXPIRED',
        'TOKEN_REVOKED',
        'TYPE_MISMATCH',
        'UNSUPPORTED_MEDIA_TYPE',
        'USER_INACTIVE',
        'VALIDATION_ERROR',
      ].sort(),
    );
  });

  it('모든 코드가 ko/en 메시지와 HTTP status를 가진다', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry.ko.length).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
    }
  });

  it('ko와 en 메시지가 서로 다르다', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CATALOG[code].ko).not.toBe(ERROR_CATALOG[code].en);
    }
  });

  it('스펙이 정한 status를 코드별로 고정한다', () => {
    expect(ERROR_CATALOG.NOT_ACCEPTABLE.status).toBe(406);
    expect(ERROR_CATALOG.UNSUPPORTED_MEDIA_TYPE.status).toBe(415);
    expect(ERROR_CATALOG.INVALID_JSONAPI_DOCUMENT.status).toBe(400);
    expect(ERROR_CATALOG.RESOURCE_NOT_FOUND.status).toBe(404);
    expect(ERROR_CATALOG.RELATIONSHIP_RESOURCE_NOT_FOUND.status).toBe(404);
    expect(ERROR_CATALOG.TYPE_MISMATCH.status).toBe(409);
    expect(ERROR_CATALOG.ID_MISMATCH.status).toBe(409);
    expect(ERROR_CATALOG.CLIENT_GENERATED_ID_UNSUPPORTED.status).toBe(403);
    expect(ERROR_CATALOG.RESOURCE_CONFLICT.status).toBe(409);
    expect(ERROR_CATALOG.VALIDATION_ERROR.status).toBe(422);
    expect(ERROR_CATALOG.INTERNAL_SERVER_ERROR.status).toBe(500);
    expect(ERROR_CATALOG.AUTHENTICATION_REQUIRED.status).toBe(401);
    expect(ERROR_CATALOG.USER_INACTIVE.status).toBe(403);
    expect(ERROR_CATALOG.EMAIL_ALREADY_REGISTERED.status).toBe(409);
  });

  it('catalogEntry가 카탈로그 항목을 돌려준다', () => {
    expect(catalogEntry('INVALID_SORT')).toBe(ERROR_CATALOG.INVALID_SORT);
  });
});

describe('JsonApiError', () => {
  it('코드의 기본 status를 물려받는다', () => {
    const error = new JsonApiError('RESOURCE_NOT_FOUND');
    expect(error.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.source).toBeUndefined();
    expect(error.detail).toBeUndefined();
  });

  it('Error를 상속하고 name이 클래스 이름이다', () => {
    const error = new JsonApiError('INVALID_FILTER');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('JsonApiError');
  });

  it('message가 카탈로그의 en 메시지다', () => {
    const error = new JsonApiError('INVALID_SORT');
    expect(error.message).toBe(ERROR_CATALOG.INVALID_SORT.en);
  });

  it('source pointer를 보존한다', () => {
    const error = new JsonApiError('VALIDATION_ERROR', {
      source: { pointer: '/data/attributes/title' },
    });
    expect(error.source).toEqual({ pointer: '/data/attributes/title' });
  });

  it('source parameter를 보존한다', () => {
    const error = new JsonApiError('INVALID_FILTER', {
      source: { parameter: 'filter[unknown]' },
    });
    expect(error.source).toEqual({ parameter: 'filter[unknown]' });
  });

  it('detail 재정의를 보존한다', () => {
    const error = new JsonApiError('INVALID_PAGE', { detail: 'page[size] must be <= 100' });
    expect(error.detail).toBe('page[size] must be <= 100');
  });

  it('HTTP_ERROR는 status 재정의를 받는다', () => {
    const error = new JsonApiError('HTTP_ERROR', { status: 418 });
    expect(error.status).toBe(418);
  });

  it('meta를 보존한다', () => {
    const error = new JsonApiError('RESOURCE_CONFLICT', { meta: { conflictingId: 'abc' } });
    expect(error.meta).toEqual({ conflictingId: 'abc' });
  });
});

describe('JsonApiErrors', () => {
  it('여러 오류를 담는다', () => {
    const aggregate = new JsonApiErrors([
      new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/a' } }),
      new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/b' } }),
    ]);
    expect(aggregate.errors).toHaveLength(2);
  });

  it('Error를 상속한다', () => {
    // 예외 필터가 `instanceof`로 갈라내고, 잡히지 않았을 때 스택이 남아야 한다.
    expect(new JsonApiErrors([new JsonApiError('VALIDATION_ERROR')])).toBeInstanceOf(Error);
  });

  it('비어 있는 목록을 거부한다', () => {
    // 오류가 없는 오류는 없다. 빈 문서(`{"errors": []}`)가 나가면 클라이언트는
    // 무엇이 잘못됐는지 알 수 없고 성공으로 오해할 수도 있다.
    expect(() => new JsonApiErrors([])).toThrow(TypeError);
  });

  it('첫 오류의 status를 대표 status로 쓴다', () => {
    const aggregate = new JsonApiErrors([
      new JsonApiError('VALIDATION_ERROR'),
      new JsonApiError('VALIDATION_ERROR'),
    ]);
    expect(aggregate.status).toBe(422);
  });
});
