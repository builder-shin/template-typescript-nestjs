import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  JsonApiNegotiationGuard,
  SkipJsonApiNegotiation,
  acceptsJsonApi,
} from '../../src/app/jsonapi/negotiation.js';

interface FakeRequest {
  readonly method: string;
  readonly headers: Record<string, string | undefined>;
}

function contextFor(request: FakeRequest): ExecutionContext {
  // handler/controller는 호출마다 같은 객체여야 한다. Reflector가 메타데이터를 찾을 때
  // 매번 다른 객체를 받으면 조회가 성립하지 않는다.
  // 두 스텁 모두 Reflector 조회 대상 자리를 채우는 용도일 뿐 호출되지 않는다.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const handler = function handler(): void {};
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  const controller = class Controller {};
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function guard(): JsonApiNegotiationGuard {
  return new JsonApiNegotiationGuard(new Reflector());
}

/**
 * 가드가 415로 거절하는지 본다.
 *
 * 본문 유무 판정에 케이스가 여럿이라, 같은 try/catch를 케이스마다 되풀이하지 않는다.
 * 코드까지 확인하므로 "무엇이든 던지기만 하면 통과"가 되지 않는다.
 */
function rejectsAsUnsupportedMediaType(context: ExecutionContext): boolean {
  try {
    guard().canActivate(context);
  } catch (error) {
    return error instanceof JsonApiError && error.code === 'UNSUPPORTED_MEDIA_TYPE';
  }
  return false;
}

describe('acceptsJsonApi', () => {
  it('헤더가 없으면 허용한다', () => {
    expect(acceptsJsonApi(undefined)).toBe(true);
  });

  it('빈 헤더는 허용한다', () => {
    expect(acceptsJsonApi('')).toBe(true);
  });

  it('와일드카드를 허용한다', () => {
    expect(acceptsJsonApi('*/*')).toBe(true);
    expect(acceptsJsonApi('application/*')).toBe(true);
  });

  it('정확한 vendor 타입을 허용한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json')).toBe(true);
  });

  it('여러 후보 중 하나가 vendor 타입이면 허용한다', () => {
    expect(acceptsJsonApi('text/html, application/vnd.api+json')).toBe(true);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(acceptsJsonApi('Application/VND.api+JSON')).toBe(true);
  });

  it('공백을 무시한다', () => {
    expect(acceptsJsonApi('  application/vnd.api+json  ')).toBe(true);
  });

  it('일반 JSON만 받는 요청은 거부한다', () => {
    expect(acceptsJsonApi('application/json')).toBe(false);
  });

  it('무관한 타입은 거부한다', () => {
    expect(acceptsJsonApi('text/html')).toBe(false);
  });

  it('미디어 타입 파라미터가 붙으면 거부한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json; charset=utf-8')).toBe(false);
  });

  it('q 파라미터는 허용한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json;q=0.9')).toBe(true);
  });

  it('모든 후보에 파라미터가 붙으면 거부한다', () => {
    expect(acceptsJsonApi('application/vnd.api+json;charset=utf-8, text/html')).toBe(false);
  });
});

describe('JsonApiNegotiationGuard', () => {
  it('GET에 vendor Accept면 통과한다', () => {
    const context = contextFor({
      method: 'GET',
      headers: { accept: 'application/vnd.api+json' },
    });
    expect(guard().canActivate(context)).toBe(true);
  });

  it('Accept가 맞지 않으면 NOT_ACCEPTABLE', () => {
    const context = contextFor({ method: 'GET', headers: { accept: 'text/html' } });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('NOT_ACCEPTABLE');
      expect(error.status).toBe(406);
      return;
    }
    throw new Error('expected NOT_ACCEPTABLE');
  });

  it('본문이 있는 요청에 vendor Content-Type이면 통과한다', () => {
    const context = contextFor({
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
      },
    });
    expect(guard().canActivate(context)).toBe(true);
  });

  it('Content-Type이 다르면 UNSUPPORTED_MEDIA_TYPE', () => {
    const context = contextFor({
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/json',
      },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(error.status).toBe(415);
      return;
    }
    throw new Error('expected UNSUPPORTED_MEDIA_TYPE');
  });

  it('Content-Type에 charset이 붙으면 거부한다', () => {
    const context = contextFor({
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json; charset=utf-8',
      },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      return;
    }
    throw new Error('expected UNSUPPORTED_MEDIA_TYPE');
  });

  it('본문 없는 메서드는 Content-Type을 보지 않는다', () => {
    // 스펙 5.1이 요구하는 대상은 "본문이 있는 요청"이다. 본문을 싣지 않은 요청이
    // 엉뚱한 Content-Type을 달고 오는 것은 그 문장이 거부하라고 한 것이 아니다.
    for (const method of ['GET', 'HEAD', 'DELETE', 'OPTIONS']) {
      const context = contextFor({
        method,
        headers: { accept: 'application/vnd.api+json', 'content-type': 'text/plain' },
      });
      expect(guard().canActivate(context)).toBe(true);
    }
  });

  it('본문을 실은 DELETE는 Content-Type이 틀리면 거부한다', () => {
    // 관계 라우트의 DELETE는 linkage 본문을 싣는다. 메서드로만 판정하면 이 본문이
    // 협상을 통과해 버린다.
    const context = contextFor({
      method: 'DELETE',
      headers: {
        accept: 'application/vnd.api+json',
        'content-length': '42',
        'content-type': 'application/json',
      },
    });
    expect(rejectsAsUnsupportedMediaType(context)).toBe(true);
  });

  it('본문을 실은 DELETE는 Content-Type이 없으면 거부한다', () => {
    const context = contextFor({
      method: 'DELETE',
      headers: { accept: 'application/vnd.api+json', 'content-length': '42' },
    });
    expect(rejectsAsUnsupportedMediaType(context)).toBe(true);
  });

  it('본문을 실은 DELETE도 vendor Content-Type이면 통과한다', () => {
    const context = contextFor({
      method: 'DELETE',
      headers: {
        accept: 'application/vnd.api+json',
        'content-length': '42',
        'content-type': 'application/vnd.api+json',
      },
    });
    expect(guard().canActivate(context)).toBe(true);
  });

  it('길이를 모르는 chunked 본문도 본문으로 본다', () => {
    // `Transfer-Encoding`이 붙으면 `Content-Length`가 없다. 길이만 보면 이 요청이
    // 본문 없는 것으로 읽혀 검사에서 샌다.
    const context = contextFor({
      method: 'DELETE',
      headers: {
        accept: 'application/vnd.api+json',
        'transfer-encoding': 'chunked',
        'content-type': 'application/json',
      },
    });
    expect(rejectsAsUnsupportedMediaType(context)).toBe(true);
  });

  it('본문 없음으로 읽는 헤더 값들', () => {
    // `Content-Length: 0`은 빈 본문이고, 빈 헤더 값은 아무것도 말하지 않는다. 둘 다
    // 본문 없음으로 읽어 본문 없는 요청과 같이 다룬다.
    const cases: Record<string, string>[] = [
      { 'content-length': '0' },
      { 'content-length': '' },
      { 'transfer-encoding': '' },
    ];
    for (const headers of cases) {
      const context = contextFor({
        method: 'DELETE',
        headers: { accept: 'application/vnd.api+json', 'content-type': 'text/plain', ...headers },
      });
      expect(guard().canActivate(context)).toBe(true);
    }
  });

  it('POST에 Content-Type이 아예 없으면 UNSUPPORTED_MEDIA_TYPE', () => {
    const context = contextFor({
      method: 'POST',
      headers: { accept: 'application/vnd.api+json' },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      return;
    }
    throw new Error('expected UNSUPPORTED_MEDIA_TYPE');
  });

  it('Accept 위반이 Content-Type 위반보다 먼저 판정된다', () => {
    const context = contextFor({
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'text/plain' },
    });
    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('NOT_ACCEPTABLE');
      return;
    }
    throw new Error('expected NOT_ACCEPTABLE');
  });
});

// 아래는 브리프에 없는 추가 테스트다. 이 저장소는 도달 가능한 모든 분기에 테스트를
// 요구하는데, 브리프의 테스트만으로는 세 갈래가 미달성으로 남는다: (1) 협상을 끄는
// `SkipJsonApiNegotiation`/가드의 skip 분기 자체가 한 번도 호출되지 않고, (2) 헤더가
// 배열로 오는 경우(`headerValue`)가 다뤄지지 않고, (3) `=`가 없는 Accept 파라미터
// (`parameterKey`)가 다뤄지지 않는다. 브리프가 준 테스트는 값 하나 바꾸지 않았다.

describe('SkipJsonApiNegotiation', () => {
  it('데코레이터가 붙은 컨트롤러는 Accept를 검사하지 않고 통과시킨다', () => {
    @SkipJsonApiNegotiation()
    class SkippedController {}
    // Reflector 조회 대상 자리를 채우는 스텁이다. 호출되지 않는다.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const handler = function handler(): void {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', headers: { accept: 'text/html' } }),
      }),
      getHandler: () => handler,
      getClass: () => SkippedController,
    } as unknown as ExecutionContext;

    expect(guard().canActivate(context)).toBe(true);
  });
});

describe('JsonApiNegotiationGuard 경계 사례', () => {
  it('Accept가 배열로 오면 첫 번째 값만 본다', () => {
    const request = {
      method: 'GET',
      headers: { accept: ['text/html', 'application/vnd.api+json'] },
    };
    // 두 스텁 모두 Reflector 조회 대상 자리를 채우는 용도일 뿐 호출되지 않는다.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const handler = function handler(): void {};
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    const controller = class Controller {};
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => controller,
    } as unknown as ExecutionContext;

    try {
      guard().canActivate(context);
    } catch (error) {
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('NOT_ACCEPTABLE');
      return;
    }
    throw new Error('expected NOT_ACCEPTABLE');
  });

  it('Accept 후보가 트레일링 세미콜론만 가지면 파라미터 없음으로 보고 허용한다', () => {
    const context = contextFor({
      method: 'GET',
      headers: { accept: 'application/vnd.api+json;' },
    });
    expect(guard().canActivate(context)).toBe(true);
  });
});
