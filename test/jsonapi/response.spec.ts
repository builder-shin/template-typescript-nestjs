import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { JSONAPI_MEDIA_TYPE } from '../../src/app/jsonapi/media-type.js';
import { NEGOTIATE_ACCEPT_KEY } from '../../src/app/jsonapi/negotiation.js';
import { JsonApiResponseInterceptor } from '../../src/app/jsonapi/response.js';

function contextFor(skip: boolean): { context: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
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
  return { context, headers };
}

const nextOf = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('JsonApiResponseInterceptor', () => {
  it('협상 대상 라우트에 vendor Content-Type을 붙인다', async () => {
    const interceptor = new JsonApiResponseInterceptor(new Reflector());
    const { context, headers } = contextFor(false);
    await firstValueFrom(interceptor.intercept(context, nextOf({ data: null })));
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
