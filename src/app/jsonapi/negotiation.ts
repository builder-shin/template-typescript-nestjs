import { Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JsonApiError } from './errors.js';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';

/**
 * JSON:API 미디어 타입 협상.
 *
 * JSON:API 1.1은 vendor 타입에 미디어 타입 파라미터를 붙이는 것을 금지한다
 * (`ext`와 `profile`만 예외). 따라서 `application/vnd.api+json; charset=utf-8`은
 * 규격 위반이고, 받아주면 클라이언트가 규격을 벗어난 채로 굳는다.
 *
 * `q`는 HTTP 협상 파라미터이지 미디어 타입 파라미터가 아니므로 허용한다. 다만 그 **값**은
 * 해석하지 않는다 — `application/vnd.api+json;q=0`(RFC 9110에서 명시적 거부)도 통과한다.
 * 값을 해석하려면 range 사이의 우선순위 규칙(구체적인 range가 와일드카드를 이긴다)까지
 * 함께 구현해야 하는데, 이 엔드포인트가 내는 미디어 타입은 하나뿐이라 "받아들이는가"는
 * 언제나 예/아니오 하나로 끝난다. 실제로 보내지지 않는 헤더를 위해 순위 해석기를 들이는
 * 대신 이 한계를 여기 적어 둔다. 언어 협상은 후보가 여럿이라 사정이 다르고, 그래서
 * `language.ts`는 `q`를 실제로 해석한다.
 */

/** 협상을 끄는 메타데이터 키. */
export const NEGOTIATE_ACCEPT_KEY = 'jsonapi:skip-negotiation';

/**
 * 이 핸들러나 컨트롤러를 협상 대상에서 제외한다.
 *
 * `health`처럼 평문 JSON을 내는 라우트에 쓴다. 협상을 생략한다는 의도를 코드에 남기는 것이
 * 목적이므로, 가드를 아예 붙이지 않는 것보다 이 데코레이터를 선호한다.
 */
export function SkipJsonApiNegotiation(): MethodDecorator & ClassDecorator {
  return SetMetadata(NEGOTIATE_ACCEPT_KEY, true);
}

/**
 * 프로토콜상 본문이 필수인 메서드. 본문 없이 와도 `Content-Type` 요구를 유지한다.
 *
 * 이 집합에 `DELETE`가 없는 것은 `DELETE`를 봐주기 위해서가 아니다 — 판정의 주된
 * 기준은 본문 유무이고(`carriesBody`), 이 집합은 "본문이 필수인데 빠뜨린 요청"까지
 * 잡기 위한 보강이다.
 */
const BODY_REQUIRED_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

/**
 * 미디어 타입 파라미터 하나(`q=0.9` 형태)의 키를 소문자로 뽑는다. `=`가 없으면 전체가 키다.
 *
 * `parameter.split('=')[0]` 대신 `indexOf`/`slice`를 쓴다 — `noUncheckedIndexedAccess`가
 * 잡을 인덱스 접근 자체가 없고, `slice`는 항상 `string`을 돌려주므로 좁힐 것이 없다.
 */
function parameterKey(parameter: string): string {
  const equalsIndex = parameter.indexOf('=');
  const key = equalsIndex === -1 ? parameter : parameter.slice(0, equalsIndex);
  return key.trim().toLowerCase();
}

/**
 * `Accept` 후보 하나가 JSON:API 응답을 받아들이는지 판정한다.
 *
 * `range.split(';')` 구조분해 대신 `indexOf`/`slice`로 미디어 타입과 파라미터를 나눈다.
 * 구조분해는 배열 타입에서 각 자리를 인덱싱하는 것과 같아서 `noUncheckedIndexedAccess`
 * 아래에서는 첫 자리도 `string | undefined`가 된다.
 */
function isJsonApiRange(range: string): boolean {
  const separator = range.indexOf(';');
  const mediaType = (separator === -1 ? range : range.slice(0, separator)).trim().toLowerCase();

  if (mediaType === '*/*' || mediaType === 'application/*') {
    return true;
  }
  if (mediaType !== JSONAPI_MEDIA_TYPE) {
    return false;
  }
  if (separator === -1) {
    return true;
  }
  // vendor 타입에는 q 이외의 파라미터를 허용하지 않는다. 빈 파라미터(트레일링 `;`)는 무시한다.
  return range
    .slice(separator + 1)
    .split(';')
    .every((parameter) => {
      const key = parameterKey(parameter);
      return key === '' || key === 'q';
    });
}

/** `Accept` 헤더가 JSON:API 응답을 받아들이는지 판정한다. */
export function acceptsJsonApi(header: string | undefined): boolean {
  if (header === undefined || header.trim() === '') {
    return true;
  }
  return header.split(',').some((range) => isJsonApiRange(range));
}

/**
 * `Content-Type` 헤더가 정확히 vendor 타입인지 판정한다.
 *
 * 여기도 구조분해 대신 `indexOf`/`slice`를 쓰는 이유는 `isJsonApiRange`와 같다.
 */
function isJsonApiContentType(header: string | undefined): boolean {
  if (header === undefined) {
    return false;
  }
  const separator = header.indexOf(';');
  const mediaType = (separator === -1 ? header : header.slice(0, separator)).trim().toLowerCase();
  if (mediaType !== JSONAPI_MEDIA_TYPE) {
    return false;
  }
  if (separator === -1) {
    return true;
  }
  return header
    .slice(separator + 1)
    .split(';')
    .every((parameter) => parameter.trim() === '');
}

interface NegotiableRequest {
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

/** 헤더 값을 하나만 뽑는다. 같은 헤더가 여러 번 오면(배열) 첫 값을 쓴다. */
function headerValue(request: NegotiableRequest, name: string): string | undefined {
  const raw = request.headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

/**
 * 요청이 본문을 싣고 있는지 본다.
 *
 * 헤더로만 판정한다. 파싱 결과(`{}`)로는 "빈 본문"과 "본문 없음"을 가를 수 없고,
 * `Content-Length`는 Node의 http 서버가 앱 코드보다 먼저 채우는 원시 헤더라 가드
 * 시점에 읽을 수 있다 — body parser의 등록 순서와 무관하다.
 */
function carriesBody(request: NegotiableRequest): boolean {
  const encoding = headerValue(request, 'transfer-encoding');
  if (encoding !== undefined && encoding.trim() !== '') {
    return true;
  }
  const length = headerValue(request, 'content-length');
  return length !== undefined && length.trim() !== '' && length.trim() !== '0';
}

/**
 * 리소스 라우트의 `Accept`와 `Content-Type`을 검증한다.
 *
 * `Accept` 위반을 먼저 판정한다. 클라이언트가 우리 응답을 읽지 못하는 상황이
 * 요청 본문 형식보다 앞선 문제이기 때문이다.
 *
 * 알려진 커버리지 갭: 이 클래스는 분기 커버리지가 100%가 아니라 97.5%로 나온다.
 * 유일한 미달성 분기는 `emitDecoratorMetadata`가 생성자 타입 정보를 내보내려고
 * 합성하는 `design:paramtypes` 삼항연산자의 `: Object` 폴백이다 — 주입 타입
 * (`Reflector`)이 런타임에 정의돼 있는 한 이 폴백은 실행될 수 없다. `__metadata`
 * 호출은 타입 체커가 원본 소스 위치 없이 완전히 새로 합성하는 노드라서, 어떤 위치에
 * 주석을 둬도 프린터가 그 노드에 트리비아를 물려줄 경로가 없다 — 그래서 `istanbul
 * ignore`로 걷어낼 자리 자체가 없다(다섯 가지 배치를 실측한 근거는
 * `task-4-report.md`의 "Fix: istanbul ignore 배치 실측" 참고). 이 현상은 생성자로
 * 의존성을 주입받는 이 템플릿의 모든 클래스에서 동일하게 재현된다 — 이 가드만의
 * 문제가 아니라, 앞으로 추가될 `@Injectable()`/`@Controller()` 등에서도 계속 나온다.
 */
@Injectable()
export class JsonApiNegotiationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(NEGOTIATE_ACCEPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<NegotiableRequest>();

    if (!acceptsJsonApi(headerValue(request, 'accept'))) {
      throw new JsonApiError('NOT_ACCEPTABLE', {
        detail: `this endpoint only produces ${JSONAPI_MEDIA_TYPE}`,
      });
    }

    // 스펙 5.1: **본문이 있는 요청**은 vendor `Content-Type`을 요구한다. 판정 기준이
    // 메서드가 아니라 본문 유무인 것이 핵심이다 — `DELETE /examples/{id}`는 본문이
    // 없지만 `DELETE /examples/{id}/relationships/tags`는 linkage 본문을 싣는다.
    // `POST`/`PUT`/`PATCH`는 프로토콜상 본문이 필수라, 본문 없이 와도 요구를 유지한다.
    const requiresJsonApiContentType =
      carriesBody(request) || BODY_REQUIRED_METHODS.has(request.method.toUpperCase());
    if (requiresJsonApiContentType && !isJsonApiContentType(headerValue(request, 'content-type'))) {
      throw new JsonApiError('UNSUPPORTED_MEDIA_TYPE', {
        detail: `this endpoint only consumes ${JSONAPI_MEDIA_TYPE} without media type parameters`,
      });
    }

    return true;
  }
}
