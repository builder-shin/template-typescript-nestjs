import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';
import { NEGOTIATE_ACCEPT_KEY } from './negotiation.js';

/**
 * 성공 응답에 vendor `Content-Type`을 붙인다.
 *
 * **전역이지만 라우트별로 끌 수 있다**: `app.module.ts`가 `APP_INTERCEPTOR`로 등록하므로
 * 이 인터셉터 자체는 필터와 마찬가지로 전역이다. 다만 성공 응답 형식은 라우트마다 다를 수
 * 있어 라우트별로 끌 수 있게 했다 — `/health`는 평문 JSON을 내므로
 * `@SkipJsonApiNegotiation()`으로 이 인터셉터만 건너뛴다. 오류 형식은 저장소 전체가
 * 하나여야 하므로 예외 필터는 끌 수 없이 모든 라우트에 무조건 적용된다
 * (`exception-filter.ts` 참고). "둘 다 전역이지만 하나만 끌 수 있다"는 이 비대칭은
 * 의도적이다.
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
