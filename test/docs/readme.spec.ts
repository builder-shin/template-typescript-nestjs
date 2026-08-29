import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('../../', import.meta.url);
const readmePath = fileURLToPath(new URL('README.md', repoRoot));
const readme = readFileSync(readmePath, 'utf8');

/**
 * 스펙이 정한 전체 검증 명령. README의 `## 검증` 절과 문자열 단위로 같아야 한다.
 * Phase 8에서 AGENTS.md가 추가되면 그 문서까지 같은 목록을 공유하는지 확인한다.
 */
const VERIFICATION_COMMANDS = [
  'pnpm install --frozen-lockfile',
  './scripts/check.sh',
  'docker compose config --quiet',
  'docker build --target runtime --tag template-typescript-nestjs:verify .',
  'docker compose up -d --build --wait',
  'docker compose down -v',
];

const HEADING = '## 검증';

/**
 * 탐색을 `## 검증` 절로 한정한다.
 *
 * 같은 명령이 `## Docker로 실행`이나 `## 개별 검사`에도 자연스럽게 등장하므로,
 * 문서 전체에서 첫 등장을 찾으면 그 앞선 등장이 잡혀 순서 단언이 깨진다.
 * 그렇다고 다른 절의 표기를 비틀면 같은 동작을 한 문서 안에서 두 가지로 적게 된다.
 * 단언해야 할 것은 "이 절이 이 목록을 이 순서로 담는가"이지
 * "이 문자열들이 문서 어디서 처음 나오는가"가 아니다.
 */
function verificationSection(): string {
  const start = readme.indexOf(HEADING);
  if (start < 0) {
    return '';
  }
  const rest = readme.slice(start + HEADING.length);
  const next = rest.indexOf('\n## ');
  return next < 0 ? rest : rest.slice(0, next);
}

const STRUCTURE_HEADING = '## 구조';

/**
 * `## 구조` 코드 펜스 안의 각 줄에서 경로 토큰만 뽑아낸다.
 *
 * 이 블록은 `## 검증` 절과 달리 테스트로 고정돼 있지 않아 드리프트하기 쉽다
 * (커밋 f0d703d 참고). `src/db/`, 그다음 `test/`와 `src/app/`이 차례로 실제와
 * 어긋났던 전례가 있고, Phase 2·6이 새 디렉터리를 만들 때 다시 어긋나기 쉽다.
 * 줄의 모양은 `path/          # 설명`이므로 각 줄의 선행 공백을 제외한 첫
 * 토큰을 경로로 본다.
 */
function structurePaths(): string[] {
  const start = readme.indexOf(STRUCTURE_HEADING);
  if (start < 0) {
    return [];
  }
  const afterHeading = readme.slice(start + STRUCTURE_HEADING.length);
  const fenceStart = afterHeading.indexOf('```text');
  if (fenceStart < 0) {
    return [];
  }
  const fenceBodyStart = afterHeading.indexOf('\n', fenceStart) + 1;
  const fenceEnd = afterHeading.indexOf('```', fenceBodyStart);
  const fenceBody = fenceEnd < 0 ? '' : afterHeading.slice(fenceBodyStart, fenceEnd);

  return fenceBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[0] ?? line);
}

describe('README', () => {
  it('검증 절을 가진다', () => {
    expect(readme).toContain(HEADING);
  });

  it('구조 절에 적은 경로가 실제로 존재한다', () => {
    const paths = structurePaths();

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(existsSync(fileURLToPath(new URL(path, repoRoot)))).toBe(true);
    }
  });

  it('검증 절이 전체 검증 명령을 문자열 그대로 담는다', () => {
    const section = verificationSection();

    for (const command of VERIFICATION_COMMANDS) {
      expect(section).toContain(command);
    }
  });

  it('검증 명령이 스펙과 같은 순서로 나온다', () => {
    const section = verificationSection();
    const positions = VERIFICATION_COMMANDS.map((command) => section.indexOf(command));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('ESM 상대 import 제약을 명시한다', () => {
    expect(readme).toContain('.js');
    expect(readme).toContain('ESM');
  });
});
