import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../../scripts/check.sh', import.meta.url));
const script = readFileSync(scriptPath, 'utf8');

describe('scripts/check.sh', () => {
  it('오류와 미정의 변수에서 즉시 중단한다', () => {
    expect(script).toContain('set -euo pipefail');
  });

  it('종료 시 임시 데이터베이스를 정리한다', () => {
    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain('down -v');
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
