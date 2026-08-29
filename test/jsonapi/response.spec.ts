import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { JSONAPI_MEDIA_TYPE } from '../../src/app/jsonapi/media-type.js';
import { NEGOTIATE_ACCEPT_KEY } from '../../src/app/jsonapi/negotiation.js';
import { JsonApiResponseInterceptor } from '../../src/app/jsonapi/response.js';

function contextFor(skip: boolean): {
  context: ExecutionContext;
  headers: Record<string, string>;
  sendBody: () => void;
} {
  const headers: Record<string, string> = {};
  // Express의 `res.send()`는 문자열 본문을 보낼 때 `Content-Type`에 `charset=utf-8`을
  // 덧붙인다(express 5.2.1에서 실제 HTTP 왕복으로 확인). Nest 어댑터가 성공 응답을
  // `res.json()`으로 내보내므로 이 단계는 인터셉터가 끝난 **뒤에** 실행된다 — 그래서
  // 이 스텁에도 그 단계를 두고, 인터셉터가 그때까지 견디는지를 확인한다.
  const response = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    sendBody(): void {
      const current = headers['content-type'];
      if (current !== undefined) {
        this.setHeader('Content-Type', `${current}; charset=utf-8`);
      }
    },
  };
  // handler/controller는 호출마다 같은 객체여야 한다. 화살표 안에서 새로 만들면
  // Reflect.defineMetadata가 버려지는 객체에 붙고 Reflector가 아무것도 못 찾는다.
  // 두 스텁 모두 Reflector 조회 대상 자리를 채우는 용도일 뿐 호출되지 않는다.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const handler = function handler(): void {};
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  const controller = class Controller {};
  if (skip) {
    Reflect.defineMetadata(NEGOTIATE_ACCEPT_KEY, true, handler);
  }
  const context = {
    switchToHttp: () => ({ getResponse: () => response }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
  return {
    context,
    headers,
    sendBody: () => {
      response.sendBody();
    },
  };
}

const nextOf = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('JsonApiResponseInterceptor', () => {
  it('협상 대상 라우트에 vendor Content-Type을 붙인다', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context, headers } = contextFor(false);
    await firstValueFrom(interceptor.intercept(context, nextOf({ data: null })));
    expect(headers['content-type']).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('본문 전송 단계가 charset을 덧붙여도 vendor 타입은 맨몸으로 남는다', async () => {
    // 이 단언이 이 저장소가 JSON:API 서버로서 지켜야 하는 계약이다 — 스펙은 응답의
    // vendor `Content-Type`에 미디어 타입 파라미터를 금지하고, 이 템플릿의 협상 가드는
    // `application/vnd.api+json; charset=utf-8`을 요청에서 415로 거부한다. 서버가 그
    // 문자열을 내보내면 자기 응답을 그대로 되돌려 보내는 클라이언트를 거절하게 된다.
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context, headers, sendBody } = contextFor(false);
    await firstValueFrom(interceptor.intercept(context, nextOf({ data: null })));
    sendBody();
    expect(headers['content-type']).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('제외된 라우트에는 붙이지 않는다', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context, headers } = contextFor(true);
    await firstValueFrom(interceptor.intercept(context, nextOf({ status: 'ok' })));
    expect(headers['content-type']).toBeUndefined();
  });

  it('본문을 그대로 통과시킨다', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context } = contextFor(false);
    const payload = { data: { type: 'examples', id: '1' } };
    await expect(firstValueFrom(interceptor.intercept(context, nextOf(payload)))).resolves.toBe(
      payload,
    );
  });

  it('undefined 본문도 통과시킨다 (204 응답)', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context } = contextFor(false);
    await expect(
      firstValueFrom(interceptor.intercept(context, nextOf(undefined))),
    ).resolves.toBeUndefined();
  });
});
