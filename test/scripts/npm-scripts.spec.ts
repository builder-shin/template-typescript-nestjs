import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const packageJsonText = readFileSync(packageJsonPath, 'utf8');

/** 스펙 13.1의 표가 이름으로 정한 스크립트. 표에서 그대로 옮긴다. */
const SPEC_13_1_SCRIPT_NAMES = [
  'lint',
  'format',
  'format:check',
  'typecheck',
  'build',
  'start',
  'test',
  'test:quick',
  'test:jsonapi',
  'test:controllers',
  'test:db',
  'migrate',
  'seed',
  'db:up',
  'worker',
  'compose:verify',
  'check',
];

/** `src/app/jsonapi/document.ts`의 `isPlainObject`와 같은 판정이다. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `package.json`의 `scripts`만 좁혀 읽는다. `JSON.parse`가 돌려주는 `any`가 이 함수
 * 밖으로 새지 않게, 값 하나하나를 `typeof`로 확인해 `Record<string, string>`을 새로
 * 짓는다.
 */
function readScripts(): Record<string, string> {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (!isPlainObject(parsed)) {
    throw new TypeError('package.json이 객체가 아니다');
  }
  const rawScripts: unknown = parsed.scripts;
  if (!isPlainObject(rawScripts)) {
    throw new TypeError('package.json에 scripts 객체가 없다');
  }

  const scripts: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawScripts)) {
    if (typeof value !== 'string') {
      throw new TypeError(`package.json의 scripts.${name}이 문자열이 아니다`);
    }
    scripts[name] = value;
  }
  return scripts;
}

const scripts = readScripts();

/**
 * 셸 의존 표기 검사가 잡는 것과 못 잡는 것.
 *
 * 잡는 것: `&&`·`||`·`$(`·`|`·홑따옴표. `$(...)` 명령 치환과 홑따옴표 인용은 POSIX
 * 셸 고유 문법이라 Windows의 기본 셸(cmd.exe)이 다르게 해석하거나 아예 무시한다 —
 * 이 표기가 있으면 그 스크립트는 bash나 WSL을 실제로 요구할 가능성이 높다.
 *
 * 못 잡는 것: 이 다섯 표기가 전혀 없어도 스크립트가 Windows에서 실패할 수 있다 —
 * POSIX 전용 실행 파일(`rm`·`cp`·`grep` 등), `export VAR=value` 같은 셸 내장 문법,
 * 줄 끝 백슬래시 이어쓰기는 이 문자열 검사망을 그대로 통과한다. 이 단언은 "셸이
 * 필요하다"의 근사이지 증명이 아니다 — 실제 증명은 Windows에서 그 스크립트를 돌려
 * 보는 것뿐이다.
 */
const SHELL_DEPENDENT_MARKERS = ['&&', '||', '$(', '|', "'"];

describe('package.json의 scripts', () => {
  it('스펙 13.1이 이름으로 정한 스크립트를 전부 가진다', () => {
    for (const name of SPEC_13_1_SCRIPT_NAMES) {
      expect(scripts).toHaveProperty(name);
    }
  });

  it('check는 ./scripts/check.sh 호출만 한다', () => {
    expect(scripts).toHaveProperty('check', './scripts/check.sh');
  });

  it('check를 제외한 스크립트에는 셸 의존 표기가 없다', () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (name === 'check') {
        continue;
      }
      for (const marker of SHELL_DEPENDENT_MARKERS) {
        expect(command).not.toContain(marker);
      }
    }
  });
});
