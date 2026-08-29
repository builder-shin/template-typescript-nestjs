import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ERROR_CATALOG, JsonApiError } from './errors.js';
import type { JsonApiErrorSource } from './errors.js';
import type { SupportedLanguage } from './language.js';
import { resolveLanguage } from './language.js';
import { JSONAPI_MEDIA_TYPE, pinJsonApiContentType } from './media-type.js';
import type { HeaderWritableResponse } from './media-type.js';

/**
 * 모든 오류를 JSON:API 오류 문서로 변환하는 전역 필터.
 *
 * **전역이고 끌 수 없는 이유**: 스펙 5.2가 "Nest 기본 오류 형식은 외부로 나가지 않는다"고
 * 정한다. 오류 형식은 저장소 전체에서 하나여야 하므로 `/health`의 404도 이 필터를 지나고,
 * 이 필터를 라우트별로 끄는 수단은 없다. 응답 인터셉터도 `APP_INTERCEPTOR`로 똑같이
 * 전역 등록되지만, 성공 응답 형식은 라우트마다 다를 수 있어 라우트별로 끌 수
 * 있다(`response.ts` 참고). "둘 다 전역이지만 하나만 끌 수 있다"는 이 비대칭은 의도적이다.
 *
 * 알 수 없는 오류의 메시지는 절대 응답에 싣지 않는다. 스택 트레이스와 내부 메시지는
 * 정보 노출 경로이고, 클라이언트가 분기에 쓸 수 있는 것은 `code`뿐이다. 대신 서버 로그로
 * 보낸다 — 자세한 규칙은 `shouldLog` 주석 참고.
 */

/** JSON:API 오류 객체. */
export interface JsonApiErrorObject {
  readonly code: string;
  /** JSON:API는 status를 문자열로 요구한다. */
  readonly status: string;
  readonly title: string;
  readonly detail?: string;
  readonly source?: JsonApiErrorSource;
  readonly meta?: Record<string, unknown>;
}

/** JSON:API 오류 문서. */
export interface ErrorDocument {
  readonly errors: readonly JsonApiErrorObject[];
}

/** `JsonApiError` 목록을 지정한 언어의 오류 문서로 만든다. */
export function buildErrorDocument(
  errors: readonly JsonApiError[],
  language: SupportedLanguage,
): ErrorDocument {
  return {
    errors: errors.map((error) => {
      const entry = ERROR_CATALOG[error.code];
      const object: {
        code: string;
        status: string;
        title: string;
        detail?: string;
        source?: JsonApiErrorSource;
        meta?: Record<string, unknown>;
      } = {
        code: error.code,
        status: String(error.status),
        title: language === 'ko' ? entry.ko : entry.en,
      };
      if (error.detail !== undefined) {
        object.detail = error.detail;
      }
      if (error.source !== undefined) {
        object.source = error.source;
      }
      if (error.meta !== undefined) {
        object.meta = error.meta;
      }
      return object;
    }),
  };
}

/**
 * 이 필터가 다루는 요청.
 *
 * `method`와 `url`은 선택이 아니다 — Express 요청에는 항상 있고, 로그 한 줄이 어떤
 * 라우트에서 나왔는지 말해 주지 못하면 그 로그는 쓸모가 없다.
 */
interface FilteredRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method: string;
  readonly url: string;
}

interface JsonApiResponse extends HeaderWritableResponse {
  status(code: number): JsonApiResponse;
  json(body: unknown): unknown;
}

/** 던져진 값을 `JsonApiError`로 정규화한다. */
function normalize(exception: unknown): JsonApiError {
  if (exception instanceof JsonApiError) {
    return exception;
  }
  if (exception instanceof HttpException) {
    return new JsonApiError('HTTP_ERROR', { status: exception.getStatus() });
  }
  return new JsonApiError('INTERNAL_SERVER_ERROR');
}

/**
 * 이 예외를 서버 로그에 남길지 판정한다.
 *
 * 이 필터가 전역으로 등록되면 Nest의 기본 처리기가 실행되지 않는다
 * (`ExceptionsHandler.next()`는 사용자 필터가 처리하면 곧바로 반환하고,
 * 알 수 없는 오류를 찍는 `BaseExceptionFilter.handleUnknownError`까지 가지 않는다).
 * 그래서 여기서 남기지 않으면 예상 못 한 예외는 **어디에도** 흔적이 남지 않는다 —
 * 클라이언트는 코드만 받고 운영자는 스택 트레이스를 영영 보지 못한다.
 *
 * 무엇을 남기고 무엇을 남기지 않는가:
 *
 * - `JsonApiError`는 남기지 않는다. 카탈로그에 있는 의도된 결과이고, 진단 정보가
 *   필요하면 던지는 쪽이 소유한다(`health.controller.ts`의 readiness가 그 예다).
 *   여기서 또 찍으면 헬스체크 주기마다 같은 내용이 두 줄씩 쌓인다.
 * - `HttpException`은 5xx만 남긴다. 라우터가 내는 404를 전부 찍으면 로그가
 *   요청 스캐너에 그대로 휩쓸린다.
 * - 나머지(예상 못 한 throw)는 모두 남긴다. 이것이 이 함수의 존재 이유다.
 */
function shouldLog(exception: unknown, status: number): boolean {
  if (exception instanceof JsonApiError) {
    return false;
  }
  if (exception instanceof HttpException) {
    return status >= 500;
  }
  return true;
}

@Catch()
export class JsonApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(JsonApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<JsonApiResponse>();
    const request = http.getRequest<FilteredRequest>();

    const raw = request.headers['accept-language'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const language = resolveLanguage(header);

    const error = normalize(exception);

    if (shouldLog(exception, error.status)) {
      // 요청 식별자를 함께 남긴다 — 코드만으로는 어떤 라우트가 터졌는지 알 수 없다.
      // 스택은 두 번째 인자로 넘긴다(Nest `Logger`의 관례).
      this.logger.error(
        `${request.method} ${request.url} -> ${error.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // 헤더를 세팅하기 전에 고정한다. Express가 본문을 보내며 덧붙이는 `charset=utf-8`이
    // vendor 타입에 붙지 않게 한다 — 근거는 `pinJsonApiContentType` 주석 참고.
    pinJsonApiContentType(response);
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    response.status(error.status).json(buildErrorDocument([error], language));
  }
}
