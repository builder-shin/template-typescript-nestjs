import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  resolveLanguage,
} from '../../src/app/jsonapi/language.js';

describe('resolveLanguage', () => {
  it('기본 언어는 ko다', () => {
    expect(DEFAULT_LANGUAGE).toBe('ko');
  });

  it('ko와 en만 지원한다', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(['en', 'ko']);
  });

  it('헤더가 없으면 기본 언어', () => {
    expect(resolveLanguage(undefined)).toBe('ko');
  });

  it('빈 헤더면 기본 언어', () => {
    expect(resolveLanguage('')).toBe('ko');
    expect(resolveLanguage('   ')).toBe('ko');
  });

  it('단일 태그를 해석한다', () => {
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('ko')).toBe('ko');
  });

  it('지역 하위 태그를 기본 언어로 접는다', () => {
    expect(resolveLanguage('en-US')).toBe('en');
    expect(resolveLanguage('ko-KR')).toBe('ko');
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(resolveLanguage('EN-us')).toBe('en');
    expect(resolveLanguage('KO')).toBe('ko');
  });

  it('품질값이 높은 쪽을 고른다', () => {
    expect(resolveLanguage('ko;q=0.3, en;q=0.9')).toBe('en');
    expect(resolveLanguage('en;q=0.3, ko;q=0.9')).toBe('ko');
  });

  it('q를 생략하면 1.0으로 본다', () => {
    expect(resolveLanguage('en, ko;q=0.9')).toBe('en');
  });

  it('품질값이 같으면 더 명시적인 태그가 이긴다', () => {
    expect(resolveLanguage('en;q=0.8, en-GB;q=0.8')).toBe('en');
    expect(resolveLanguage('ko;q=0.5, en-US;q=0.5, en;q=0.5')).toBe('en');
  });

  it('품질값과 명시도가 모두 같으면 먼저 온 쪽이 이긴다', () => {
    expect(resolveLanguage('en, ko')).toBe('en');
    expect(resolveLanguage('ko, en')).toBe('ko');
  });

  it('q=0은 거부이므로 후보에서 뺀다', () => {
    expect(resolveLanguage('en;q=0, ko;q=0.1')).toBe('ko');
    expect(resolveLanguage('en;q=0')).toBe('ko');
  });

  it('지원하지 않는 언어만 오면 기본 언어', () => {
    expect(resolveLanguage('fr, de;q=0.9')).toBe('ko');
  });

  it('지원하지 않는 언어를 건너뛰고 지원하는 언어를 고른다', () => {
    expect(resolveLanguage('fr;q=1.0, en;q=0.1')).toBe('en');
  });

  it('와일드카드는 기본 언어로 해석한다', () => {
    expect(resolveLanguage('*')).toBe('ko');
  });

  it('와일드카드보다 명시된 지원 언어를 우선한다', () => {
    expect(resolveLanguage('*;q=0.9, en;q=0.1')).toBe('en');
  });

  it('깨진 q 값은 해당 항목을 버린다', () => {
    expect(resolveLanguage('en;q=abc, ko;q=0.5')).toBe('ko');
  });

  it('빈 항목을 건너뛴다', () => {
    expect(resolveLanguage('en,,ko')).toBe('en');
  });

  // 브리프에 명시된 위 18개 케이스에는 포함되지 않았지만, `resolve_language` 알고리즘
  // 자체에 있는 분기라 커버리지 100%를 유지하려면 필요한 보충 케이스다.
  it('세미콜론 앞에 언어 태그가 없으면 그 항목을 버린다', () => {
    expect(resolveLanguage(';q=0.5, en;q=0.9')).toBe('en');
  });

  it('q가 아닌 매개변수는 무시하고 기본 품질값 1을 쓴다', () => {
    expect(resolveLanguage('en;level=1, ko;q=0.9')).toBe('en');
  });
});
