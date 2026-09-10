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

  it('이미 주어진 TEST_REDIS_URL을 존중한다', () => {
    // db와 redis는 서로 독립적으로 판단해야 한다 — 한쪽만 주어졌을 때 그 서비스는
    // 건너뛰고 나머지 하나만 띄워야 한다.
    expect(script).toContain('if [[ -z "${TEST_REDIS_URL:-}" ]]; then');
  });

  it('임의 포트로 임시 Redis를 띄운다', () => {
    expect(script).toContain('TEST_REDIS_PORT=0');
  });

  it('db나 redis 중 하나라도 띄웠으면 종료 시 정리한다', () => {
    // `down -v`는 컴포즈 프로젝트 전체를 내리므로 서비스별 플래그를 따로 둘 필요가
    // 없다 — "무엇이든 하나라도 띄웠는가"만 알면 정리 여부를 결정하기에 충분하다.
    // 대신 플래그 이름이 db 전용으로 읽히면 안 되므로 두 서비스를 함께 가리키는
    // 이름을 쓴다.
    expect(cleanupBody()).toContain('started_test_services');
    expect(script).not.toContain('started_test_database');
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
