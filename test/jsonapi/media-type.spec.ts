import {
  JSONAPI_MEDIA_TYPE,
  pinJsonApiContentType,
  stripVendorMediaTypeParameters,
} from '../../src/app/jsonapi/media-type.js';

describe('JSONAPI_MEDIA_TYPE', () => {
  it('JSON:API 1.1 vendor 미디어 타입이다', () => {
    expect(JSONAPI_MEDIA_TYPE).toBe('application/vnd.api+json');
  });
});

describe('stripVendorMediaTypeParameters', () => {
  it('파라미터가 없으면 그대로 둔다', () => {
    expect(stripVendorMediaTypeParameters(JSONAPI_MEDIA_TYPE)).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('vendor 타입의 charset을 떼어낸다', () => {
    expect(stripVendorMediaTypeParameters('application/vnd.api+json; charset=utf-8')).toBe(
      JSONAPI_MEDIA_TYPE,
    );
  });

  it('공백이나 대소문자가 달라도 떼어낸다', () => {
    expect(stripVendorMediaTypeParameters('  Application/VND.api+JSON ;charset=utf-8')).toBe(
      JSONAPI_MEDIA_TYPE,
    );
  });

  it('vendor 타입이 아니면 파라미터를 그대로 둔다', () => {
    expect(stripVendorMediaTypeParameters('application/json; charset=utf-8')).toBe(
      'application/json; charset=utf-8',
    );
    expect(stripVendorMediaTypeParameters('text/html; charset=iso-8859-1')).toBe(
      'text/html; charset=iso-8859-1',
    );
  });
});

/**
 * Express가 하는 일을 그대로 흉내 내는 응답 스텁.
 *
 * `res.send()`는 본문이 문자열이면 `Content-Type`에 `charset=utf-8`을 덧붙인다. 이 저장소의
 * express 5.2.1에서 실제 HTTP 왕복으로 확인한 동작이고(`application/vnd.api+json` →
 * `application/vnd.api+json; charset=utf-8`), `pinJsonApiContentType`이 존재하는 이유다.
 * `sendBody()`가 그 한 단계를 재현한다.
 */
function responseStub(): {
  setHeader(name: string, value: string): void;
  sendBody(): void;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string): void {
      headers[name.toLowerCase()] = value;
    },
    sendBody(): void {
      const current = headers['content-type'];
      if (current !== undefined) {
        this.setHeader('Content-Type', `${current}; charset=utf-8`);
      }
    },
  };
}

describe('pinJsonApiContentType', () => {
  it('전송 단계에서 덧붙는 charset을 막는다', () => {
    const response = responseStub();
    pinJsonApiContentType(response);
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    response.sendBody();

    expect(response.headers['content-type']).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('고정하지 않으면 charset이 붙는다 (이 테스트가 지키는 것)', () => {
    const response = responseStub();
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    response.sendBody();

    expect(response.headers['content-type']).toBe('application/vnd.api+json; charset=utf-8');
  });

  it('두 번 고정해도 결과가 같다', () => {
    const response = responseStub();
    pinJsonApiContentType(response);
    pinJsonApiContentType(response);
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    response.sendBody();

    expect(response.headers['content-type']).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('vendor 타입이 아닌 Content-Type은 건드리지 않는다', () => {
    const response = responseStub();
    pinJsonApiContentType(response);
    response.setHeader('Content-Type', 'application/json');
    response.sendBody();

    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('Content-Type이 아닌 헤더는 그대로 통과시킨다', () => {
    const response = responseStub();
    pinJsonApiContentType(response);
    response.setHeader('Location', '/api/v1/examples/1');

    expect(response.headers.location).toBe('/api/v1/examples/1');
  });

  it('문자열이 아닌 헤더 값도 그대로 통과시킨다', () => {
    // Node의 `setHeader`는 숫자와 문자열 배열도 받는다. 감싼 함수가 그 값을 잃으면
    // `Content-Length`나 다중 `Set-Cookie`가 조용히 깨진다.
    const values: unknown[] = [];
    const response = {
      setHeader(_name: string, value: string | number | readonly string[]): void {
        values.push(value);
      },
    };
    pinJsonApiContentType(response);
    response.setHeader('Content-Length', 12);
    response.setHeader('Set-Cookie', ['a=1', 'b=2']);

    expect(values).toEqual([12, ['a=1', 'b=2']]);
  });
});
