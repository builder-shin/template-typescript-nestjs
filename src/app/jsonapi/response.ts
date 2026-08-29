import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';
import { NEGOTIATE_ACCEPT_KEY } from './negotiation.js';

/**
 * 성공 응답에 vendor `Content-Type`을 붙인다.
 *
 * **전역이 아닌 이유**: 성공 응답 형식은 라우트마다 다르다. `/health`는 평문 JSON을
 * 내므로 `@SkipJsonApiNegotiation()`으로 제외한다. 오류 형식은 전 저장소가 하나이므로
 * 예외 필터는 전역이다(`exception-filter.ts` 참고). 이 비대칭은 의도적이다.
 *
 * 협상 가드와 같은 메타데이터 키를 읽는다. "이 라우트는 JSON:API가 아니다"라는 선언이
 * 요청과 응답 양쪽에 같은 뜻으로 적용되어야 하므로 키를 나누지 않는다.
 */
@Injectable()
export class JsonApiResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(NEGOTIATE_ACCEPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!skip) {
      context
        .switchToHttp()
        .getResponse<{ setHeader(name: string, value: string): unknown }>()
        .setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    }
    return next.handle();
  }
}
