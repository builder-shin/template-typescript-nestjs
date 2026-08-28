import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url));
const readme = readFileSync(readmePath, 'utf8');

/**
 * 스펙이 정한 전체 검증 명령. README와 문자열 단위로 같아야 한다.
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

describe('README', () => {
  it('검증 절을 가진다', () => {
    expect(readme).toContain('## 검증');
  });

  it('전체 검증 명령을 문자열 그대로 담는다', () => {
    for (const command of VERIFICATION_COMMANDS) {
      expect(readme).toContain(command);
    }
  });

  it('검증 명령이 스펙과 같은 순서로 나온다', () => {
    const positions = VERIFICATION_COMMANDS.map((command) => readme.indexOf(command));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('ESM 상대 import 제약을 명시한다', () => {
    expect(readme).toContain('.js');
    expect(readme).toContain('ESM');
  });
});
