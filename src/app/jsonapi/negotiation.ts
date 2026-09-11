import { Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JsonApiError } from './errors.js';
import { JSONAPI_MEDIA_TYPE } from './media-type.js';

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

/** Split HTTP parameters while preserving delimiters inside quoted strings. */
function splitQuoted(value: string, delimiter: string): string[] | undefined {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      current += character;
      quoted = !quoted;
      continue;
    }
    if (character === delimiter && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (quoted || escaped) return undefined;
  parts.push(current);
  return parts;
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function validParameter(value: string): boolean {
  if (!value.startsWith('"')) return TOKEN.test(value);
  if (value.length < 2 || !value.endsWith('"')) return false;
  let escaped = false;
  for (const character of value.slice(1, -1)) {
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '"') return false;
  }
  return !escaped;
}

function parseMedia(value: string): { media: string; parameters: Map<string, string> } | undefined {
  const parts = splitQuoted(value, ';');
  const media = parts?.shift()?.trim().toLowerCase();
  if (!media || parts === undefined) return undefined;
  const parameters = new Map<string, string>();
  for (const part of parts) {
    const parameter = part.replace(/^[ \t]+/, '');
    const equals = parameter.indexOf('=');
    if (equals === -1) return undefined;
    const name = parameter.slice(0, equals).toLowerCase();
    const raw = parameter.slice(equals + 1);
    if (!TOKEN.test(name) || !validParameter(raw) || parameters.has(name)) return undefined;
    parameters.set(name, raw);
  }
  return { media, parameters };
}

export function acceptsJsonApi(header: string | undefined): boolean {
  if (header === undefined || header.trim() === '') return true;
  const qualities = new Map<number, number[]>();
  for (const entry of splitQuoted(header, ',') ?? []) {
    const parsed = parseMedia(entry);
    if (parsed === undefined) continue;
    const { media, parameters } = parsed;
    const rawQuality = parameters.get('q') ?? '1';
    if (!QUALITY.test(rawQuality)) continue;
    const specificity =
      media === JSONAPI_MEDIA_TYPE ? 2 : media === 'application/*' ? 1 : media === '*/*' ? 0 : -1;
    if (specificity === -1) continue;
    const allowed = media === JSONAPI_MEDIA_TYPE ? ['q', 'profile'] : ['q'];
    const unsupported = [...parameters.keys()].some((name) => !allowed.includes(name));
    if (unsupported && specificity !== 2) continue;
    const values = qualities.get(specificity) ?? [];
    values.push(unsupported ? 0 : Number(rawQuality));
    qualities.set(specificity, values);
  }
  for (const specificity of [2, 1, 0]) {
    const values = qualities.get(specificity);
    if (values !== undefined) return Math.max(...values) > 0;
  }
  return false;
}

export function isJsonApiContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  const parsed = parseMedia(header.trim());
  return (
    parsed?.media === JSONAPI_MEDIA_TYPE &&
    [...parsed.parameters.keys()].every((name) => name === 'profile')
  );
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
      throw new JsonApiError('NOT_ACCEPTABLE', { source: { header: 'Accept' } });
    }

    // 스펙 5.1: **본문이 있는 요청**은 vendor `Content-Type`을 요구한다. 판정 기준이
    // 메서드가 아니라 본문 유무인 것이 핵심이다 — `DELETE /examples/{id}`는 본문이
    // 없지만 `DELETE /examples/{id}/relationships/tags`는 linkage 본문을 싣는다.
    // `POST`/`PUT`/`PATCH`는 프로토콜상 본문이 필수라, 본문 없이 와도 요구를 유지한다.
    const requiresJsonApiContentType =
      !['GET', 'HEAD'].includes(request.method.toUpperCase()) &&
      (carriesBody(request) || BODY_REQUIRED_METHODS.has(request.method.toUpperCase()));
    if (requiresJsonApiContentType && !isJsonApiContentType(headerValue(request, 'content-type'))) {
      throw new JsonApiError('UNSUPPORTED_MEDIA_TYPE', { source: { header: 'Content-Type' } });
    }

    return true;
  }
}
