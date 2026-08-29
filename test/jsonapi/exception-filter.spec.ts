import {
  ConsoleLogger,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ERROR_CATALOG, JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  JsonApiExceptionFilter,
  buildErrorDocument,
} from '../../src/app/jsonapi/exception-filter.js';
import { JSONAPI_MEDIA_TYPE } from '../../src/app/jsonapi/media-type.js';

interface CapturedResponse {
  status?: number;
  headers: Record<string, string>;
  body?: unknown;
}

function hostFor(acceptLanguage?: string | string[]): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { headers: {} };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const request = {
    headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
    method: 'GET',
    url: '/api/v1/examples',
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

/**
 * `noUncheckedIndexedAccess` 아래에서 `arr[0]`은 `T | undefined`다. 캐스트로 지우는 대신
 * 실제 분기로 좁힌다 — 이 헬퍼가 던지는 경우는 테스트 픽스처가 빈 배열을 준 것이므로
 * 그 자체로 테스트 실패 사유다.
 */
function firstOf<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

describe('buildErrorDocument', () => {
  it('오류 하나를 문서로 만든다', () => {
    const document = buildErrorDocument([new JsonApiError('RESOURCE_NOT_FOUND')], 'en');
    expect(document.errors).toHaveLength(1);
    const error = firstOf(document.errors);
    expect(error.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.status).toBe('404');
    expect(error.title).toBe(ERROR_CATALOG.RESOURCE_NOT_FOUND.en);
  });

  it('status를 문자열로 담는다 (JSON:API 규격)', () => {
    const document = buildErrorDocument([new JsonApiError('VALIDATION_ERROR')], 'ko');
    const error = firstOf(document.errors);
    expect(typeof error.status).toBe('string');
    expect(error.status).toBe('422');
  });

  it('언어에 따라 title이 달라진다', () => {
    const ko = buildErrorDocument([new JsonApiError('INVALID_SORT')], 'ko');
    const en = buildErrorDocument([new JsonApiError('INVALID_SORT')], 'en');
    expect(firstOf(ko.errors).title).toBe(ERROR_CATALOG.INVALID_SORT.ko);
    expect(firstOf(en.errors).title).toBe(ERROR_CATALOG.INVALID_SORT.en);
  });

  it('source pointer를 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/title' } })],
      'ko',
    );
    expect(firstOf(document.errors).source).toEqual({ pointer: '/data/attributes/title' });
  });

  it('source parameter를 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('INVALID_FILTER', { source: { parameter: 'filter[x]' } })],
      'ko',
    );
    expect(firstOf(document.errors).source).toEqual({ parameter: 'filter[x]' });
  });

  it('detail을 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('INVALID_PAGE', { detail: 'page[size] must be <= 100' })],
      'ko',
    );
    expect(firstOf(document.errors).detail).toBe('page[size] must be <= 100');
  });

  it('detail이 없으면 멤버를 생략한다', () => {
    const document = buildErrorDocument([new JsonApiError('RESOURCE_NOT_FOUND')], 'ko');
    expect('detail' in firstOf(document.errors)).toBe(false);
  });

  it('source가 없으면 멤버를 생략한다', () => {
    const document = buildErrorDocument([new JsonApiError('RESOURCE_NOT_FOUND')], 'ko');
    expect('source' in firstOf(document.errors)).toBe(false);
  });

  it('meta를 보존한다', () => {
    const document = buildErrorDocument(
      [new JsonApiError('RESOURCE_CONFLICT', { meta: { id: 'x' } })],
      'ko',
    );
    expect(firstOf(document.errors).meta).toEqual({ id: 'x' });
  });

  it('오류 여러 개를 한 문서에 담는다', () => {
    const document = buildErrorDocument(
      [
        new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/a' } }),
        new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/b' } }),
      ],
      'ko',
    );
    expect(document.errors).toHaveLength(2);
  });
});

/** `Logger.overrideLogger`로 가로챈 `error` 호출 한 건. */
interface LoggedError {
  readonly message: unknown;
  readonly params: readonly unknown[];
}

describe('JsonApiExceptionFilter', () => {
  const filter = new JsonApiExceptionFilter();
  const logged: LoggedError[] = [];

  /**
   * Nest `Logger`의 정적 출력 대상을 가로챈다.
   *
   * `Logger.overrideLogger`는 프레임워크가 공개한 API이고, 인스턴스의 `localInstance`
   * getter가 호출마다 이 정적 참조를 다시 읽으므로 이미 만들어진 필터 인스턴스에도
   * 적용된다. mocking 프레임워크가 필요 없다 — 이 저장소의 ESM +
   * `--experimental-vm-modules` 조합에서는 `jest` 전역이 주입되지 않는다.
   *
   * 가로채지 않으면 아래의 "알 수 없는 오류" 테스트들이 스택 트레이스를 테스트 출력에
   * 쏟아낸다. 잡음을 없애는 김에 무엇이 실제로 기록되는지도 함께 단언한다.
   */
  beforeAll(() => {
    Logger.overrideLogger({
      log: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      verbose: () => undefined,
      error: (message: unknown, ...params: unknown[]) => {
        logged.push({ message, params });
      },
    });
  });

  afterAll(() => {
    // 정적 상태이므로 반드시 되돌린다. Jest는 파일마다 모듈 레지스트리를 새로 만들지만,
    // 이 파일 안의 뒤따르는 describe까지 영향을 받는 것을 막는다.
    Logger.overrideLogger(new ConsoleLogger());
  });

  beforeEach(() => {
    logged.length = 0;
  });

  it('JsonApiError의 status와 코드를 그대로 낸다', () => {
    const { host, captured } = hostFor();
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    expect(captured.status).toBe(404);
    const body = captured.body as { errors: { code: string }[] };
    expect(firstOf(body.errors).code).toBe('RESOURCE_NOT_FOUND');
  });

  it('vendor Content-Type으로 응답한다', () => {
    const { host, captured } = hostFor();
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    expect(captured.headers['content-type']).toBe(JSONAPI_MEDIA_TYPE);
  });

  it('Accept-Language를 따라 ko 메시지를 낸다', () => {
    const { host, captured } = hostFor('ko');
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    const body = captured.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.RESOURCE_NOT_FOUND.ko);
  });

  it('Accept-Language를 따라 en 메시지를 낸다', () => {
    const { host, captured } = hostFor('en');
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    const body = captured.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.RESOURCE_NOT_FOUND.en);
  });

  it('헤더가 없으면 ko가 기본이다', () => {
    const { host, captured } = hostFor();
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    const body = captured.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.RESOURCE_NOT_FOUND.ko);
  });

  it('Accept-Language가 배열로 오면 첫 번째 값만 본다', () => {
    // 동일 헤더가 여러 번 오면 Node가 배열로 넘긴다. 두 번째 값도 지원 언어이면
    // 배열 처리가 깨져도 우연히 통과할 수 있으므로, 서로 다른 언어를 섞어 첫 번째
    // 값만 실제로 쓰이는지 구분한다.
    const { host, captured } = hostFor(['en', 'ko']);
    filter.catch(new JsonApiError('RESOURCE_NOT_FOUND'), host);
    const body = captured.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.RESOURCE_NOT_FOUND.en);
  });

  it('Nest HttpException을 HTTP_ERROR로 감싸고 status를 유지한다', () => {
    const { host, captured } = hostFor();
    filter.catch(new NotFoundException(), host);
    expect(captured.status).toBe(404);
    const body = captured.body as { errors: { code: string; status: string }[] };
    const error = firstOf(body.errors);
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.status).toBe('404');
  });

  it('임의 status의 HttpException도 유지한다', () => {
    const { host, captured } = hostFor();
    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);
    expect(captured.status).toBe(418);
  });

  it('알 수 없는 오류는 INTERNAL_SERVER_ERROR 500이다', () => {
    const { host, captured } = hostFor();
    filter.catch(new Error('boom'), host);
    expect(captured.status).toBe(500);
    const body = captured.body as { errors: { code: string }[] };
    expect(firstOf(body.errors).code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('던져진 값이 Error가 아니어도 500으로 처리한다', () => {
    const { host, captured } = hostFor();
    filter.catch('문자열이 던져졌다', host);
    expect(captured.status).toBe(500);
    const body = captured.body as { errors: { code: string }[] };
    expect(firstOf(body.errors).code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('내부 오류 메시지를 응답에 노출하지 않는다', () => {
    const { host, captured } = hostFor();
    filter.catch(new Error('데이터베이스 비밀번호가 틀렸습니다'), host);
    expect(JSON.stringify(captured.body)).not.toContain('비밀번호');
  });

  // 이 필터가 전역으로 등록되면 Nest의 기본 처리기가 실행되지 않으므로, 여기서 남기지
  // 않는 예외는 어디에도 흔적이 남지 않는다. 아래 다섯 개가 "무엇을 남기고 무엇을
  // 남기지 않는가"를 고정한다.
  it('예상 못 한 예외는 서버 로그에 남긴다', () => {
    const { host } = hostFor();
    filter.catch(new Error('boom'), host);

    const entry = firstOf(logged);
    expect(String(entry.message)).toBe('GET /api/v1/examples -> INTERNAL_SERVER_ERROR');
    // 스택은 두 번째 인자로 넘어간다. 응답에서 감춘 원인을 서버 쪽에서는 볼 수 있어야 한다.
    expect(entry.params.some((param) => typeof param === 'string' && param.includes('boom'))).toBe(
      true,
    );
  });

  it('Error가 아닌 값이 던져져도 남긴다', () => {
    const { host } = hostFor();
    filter.catch('문자열이 던져졌다', host);

    const entry = firstOf(logged);
    expect(
      entry.params.some(
        (param) => typeof param === 'string' && param.includes('문자열이 던져졌다'),
      ),
    ).toBe(true);
  });

  it('JsonApiError는 남기지 않는다', () => {
    // 카탈로그에 있는 의도된 결과다. 진단이 필요하면 던지는 쪽이 소유한다 —
    // 여기서 또 찍으면 헬스체크 주기마다 같은 내용이 두 줄씩 쌓인다.
    const { host } = hostFor();
    filter.catch(new JsonApiError('INTERNAL_SERVER_ERROR'), host);
    expect(logged).toHaveLength(0);
  });

  it('4xx HttpException은 남기지 않는다', () => {
    // 라우터가 내는 404를 전부 찍으면 로그가 요청 스캐너에 그대로 휩쓸린다.
    const { host } = hostFor();
    filter.catch(new NotFoundException(), host);
    expect(logged).toHaveLength(0);
  });

  it('5xx HttpException은 남긴다', () => {
    const { host } = hostFor();
    filter.catch(new HttpException('gateway', HttpStatus.BAD_GATEWAY), host);
    expect(String(firstOf(logged).message)).toBe('GET /api/v1/examples -> HTTP_ERROR');
  });
});
