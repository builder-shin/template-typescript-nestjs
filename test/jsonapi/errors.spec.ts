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

  it('모든 코드가 ko/en 의 title·detail 과 HTTP status를 가진다', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      for (const message of [entry.ko, entry.en]) {
        expect(message.title.length).toBeGreaterThan(0);
        expect(message.detail.length).toBeGreaterThan(0);
      }
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
    }
  });

  // title 과 detail 이 **둘 다** 언어별로 갈려야 한다. detail 만 한 언어에
  // 머물면 한국어 사용자가 영문 설명을 읽는다 - 그것이 이 카탈로그를 고친 이유다.
  it('ko와 en 이 title·detail 둘 다 서로 다르다', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry.ko.title).not.toBe(entry.en.title);
      expect(entry.ko.detail).not.toBe(entry.en.detail);
    }
  });

  // 한국어 문구에 한글이 실제로 있는지 본다. 두 자리에 같은 영문을 넣어도 위
  // 테스트는 통과하지만 여기서 죽는다.
  it('ko 문구에 한글이 들어 있다', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry.ko.title).toMatch(/[가-힣]/);
      expect(entry.ko.detail).toMatch(/[가-힣]/);
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
  });

  it('Error를 상속하고 name이 클래스 이름이다', () => {
    const error = new JsonApiError('INVALID_FILTER');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('JsonApiError');
  });

  it('message가 카탈로그의 en title 이다', () => {
    const error = new JsonApiError('INVALID_SORT');
    expect(error.message).toBe(ERROR_CATALOG.INVALID_SORT.en.title);
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

  // `detail` 재정의는 없앴다. 문구는 카탈로그가 언어별로 갖고, 무엇이
  // 잘못됐는지는 `source` 가 말한다 - 자유 문자열은 협상되지 않는다.
  it('detail 을 받는 통로가 없다', () => {
    expect(Object.keys(new JsonApiError('INVALID_PAGE'))).not.toContain('detail');
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
