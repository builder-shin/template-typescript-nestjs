/**
 * `Accept-Language` 해석.
 *
 * 오류 메시지의 언어를 고르는 단 하나의 규칙이다. 참조 구현의 `resolve_language`를
 * 그대로 옮겼다 — 품질값(`q`)이 1순위, 태그 명시도가 2순위, 헤더 등장 순서가 3순위다.
 * `q=0`은 RFC 9110에서 명시적 거부이므로 후보에서 제외한다.
 *
 * 지원하지 않는 언어만 요청되면 기본값 `ko`를 쓴다. 요청을 거절하지 않는다 —
 * 언어 협상 실패는 오류가 아니라 기본값으로 되돌아갈 사유다.
 */

/** 이 템플릿이 메시지를 제공하는 언어. */
export type SupportedLanguage = 'ko' | 'en';

/** 협상이 실패했을 때 쓰는 언어. */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ko';

/** 지원 언어 목록. */
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ['ko', 'en'];

interface LanguageRange {
  /** 기본 하위 태그(`en-GB` → `en`). 와일드카드면 `*`. */
  readonly base: string;
  /** 품질값. 0 초과 1 이하. */
  readonly quality: number;
  /** 하위 태그 개수. 같은 품질값에서 더 명시적인 쪽을 고르는 데 쓴다. */
  readonly specificity: number;
  /** 헤더 등장 순서. 앞의 두 기준이 같을 때의 tie breaker. */
  readonly position: number;
}

function isSupported(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** `en-GB;q=0.8` 한 항목을 파싱한다. 형식이 깨졌거나 q=0이면 `undefined`. */
function parseRange(raw: string, position: number): LanguageRange | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }

  const [tagPart, ...parameters] = trimmed.split(';');
  // `trimmed`가 빈 문자열이 아니므로 `split(';')`은 항상 원소를 하나 이상 반환해
  // `tagPart`는 실제로 `undefined`가 될 수 없지만, `noUncheckedIndexedAccess` 아래에서는
  // 배열 구조분해 값도 `string | undefined`로 취급된다. `??`로 타입만 좁히고
  // (도달 불가능한) 새 분기는 만들지 않는다.
  const tag = (tagPart ?? '').trim().toLowerCase();
  if (tag === '') {
    return undefined;
  }

  let quality = 1;
  for (const parameter of parameters) {
    const [key, value] = parameter.split('=');
    if (key === undefined || value === undefined || key.trim().toLowerCase() !== 'q') {
      continue;
    }
    const parsed = Number.parseFloat(value.trim());
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    quality = parsed;
  }

  if (quality <= 0) {
    return undefined;
  }

  const subtags = tag.split('-');
  // 위와 같은 이유로 `subtags[0]`도 `string | undefined`로 취급된다.
  // `tag`가 빈 문자열이 아니므로 실제로 `undefined`가 될 수는 없다 — `??`로 타입만 좁힌다.
  return {
    base: subtags[0] ?? tag,
    quality,
    specificity: subtags.length,
    position,
  };
}

/** 두 후보 중 우선하는 쪽을 고른다. 품질값 → 명시도 → 등장 순서. */
function outranks(candidate: LanguageRange, incumbent: LanguageRange): boolean {
  if (candidate.quality !== incumbent.quality) {
    return candidate.quality > incumbent.quality;
  }
  if (candidate.specificity !== incumbent.specificity) {
    return candidate.specificity > incumbent.specificity;
  }
  return candidate.position < incumbent.position;
}

/**
 * `Accept-Language` 헤더에서 응답 언어를 고른다.
 *
 * 지원하지 않는 언어와 와일드카드는 후보에서 빠지고, 남은 후보가 없으면 기본값을 쓴다.
 */
export function resolveLanguage(header: string | undefined): SupportedLanguage {
  if (header === undefined || header.trim() === '') {
    return DEFAULT_LANGUAGE;
  }

  let best: LanguageRange | undefined;
  let bestLanguage: SupportedLanguage | undefined;

  header.split(',').forEach((raw, index) => {
    const range = parseRange(raw, index);
    if (range === undefined || !isSupported(range.base)) {
      return;
    }
    if (best === undefined || outranks(range, best)) {
      best = range;
      bestLanguage = range.base;
    }
  });

  return bestLanguage ?? DEFAULT_LANGUAGE;
}
