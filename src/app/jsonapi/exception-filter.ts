import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ERROR_CATALOG, JsonApiError } from './errors.js';
import type { JsonApiErrorSource } from './errors.js';
import type { SupportedLanguage } from './language.js';
import { resolveLanguage } from './language.js';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';

/**
 * 모든 오류를 JSON:API 오류 문서로 변환하는 전역 필터.
 *
 * **전역인 이유**: 스펙 5.2가 "Nest 기본 오류 형식은 외부로 나가지 않는다"고 정한다.
 * 오류 형식은 저장소 전체에서 하나여야 하므로 `/health`의 404도 이 필터를 지난다.
 * 성공 응답 형식은 라우트마다 다르므로(`response.ts` 참고) 인터셉터는 전역이 아니다.
 * 이 비대칭은 의도적이다.
 *
 * 알 수 없는 오류의 메시지는 절대 응답에 싣지 않는다. 스택 트레이스와 내부 메시지는
 * 정보 노출 경로이고, 클라이언트가 분기에 쓸 수 있는 것은 `code`뿐이다.
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

interface LanguageAwareRequest {
  readonly headers: Record<string, string | string[] | undefined>;
}

interface JsonApiResponse {
  status(code: number): JsonApiResponse;
  setHeader(name: string, value: string): unknown;
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

@Catch()
export class JsonApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<JsonApiResponse>();
    const request = http.getRequest<LanguageAwareRequest>();

    const raw = request.headers['accept-language'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const language = resolveLanguage(header);

    const error = normalize(exception);
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    response.status(error.status).json(buildErrorDocument([error], language));
  }
}
