import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../../scripts/check.sh', import.meta.url));
const script = readFileSync(scriptPath, 'utf8');

const CLEANUP_MARKER = 'cleanup() {';

/**
 * 탐색을 `cleanup()` 함수 본문으로 한정한다.
 *
 * `down -v`는 파일 어디에 있어도 기존 `toContain` 단언을 통과했다. 그 명령이
 * `cleanup()` 밖으로 옮겨져도 이 테스트는 알아채지 못했을 것이다. 단언해야 할
 * 것은 "정리 함수가 이 명령을 실행하는가"이지 "이 문자열이 파일 어딘가에
 * 있는가"가 아니다.
 */
function cleanupBody(): string {
  const start = script.indexOf(CLEANUP_MARKER);
  if (start < 0) {
    return '';
  }
  const rest = script.slice(start + CLEANUP_MARKER.length);
  const end = rest.indexOf('\n}');
  return end < 0 ? rest : rest.slice(0, end);
}

describe('scripts/check.sh', () => {
  it('오류와 미정의 변수에서 즉시 중단한다', () => {
    expect(script).toContain('set -euo pipefail');
  });

  it('종료 시 임시 데이터베이스를 정리한다', () => {
    expect(script).toContain('trap cleanup EXIT');
    expect(cleanupBody()).toContain('down -v');
  });

  it('이미 주어진 TEST_DATABASE_URL을 존중한다', () => {
    expect(script).toContain('if [[ -z "${TEST_DATABASE_URL:-}" ]]; then');
  });

  it('임의 포트로 임시 데이터베이스를 띄운다', () => {
    expect(script).toContain('TEST_DB_PORT=0');
  });

  it('다섯 가지 검사를 순서대로 실행한다', () => {
    const checks = [
      'pnpm exec eslint .',
      'pnpm exec prettier --check .',
      'pnpm exec tsc --noEmit -p tsconfig.json',
      'pnpm run test',
      'pnpm exec secretlint',
    ];
    const positions = checks.map((check) => script.indexOf(check));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
