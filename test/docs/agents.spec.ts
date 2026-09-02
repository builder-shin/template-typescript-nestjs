import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERIFICATION_COMMANDS, extractSection } from './verification-section.js';

const repoRoot = new URL('../../', import.meta.url);

function absolute(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, repoRoot));
}

/**
 * 스펙 14장의 문서 구조 표가 요구하는 아홉 개 `AGENTS.md`. 표에서 그대로 옮긴다
 * (README.md는 표에 있지만 `AGENTS.md`가 아니므로 뺀다).
 *
 * Phase 8은 이 중 루트 `AGENTS.md` 하나만 만든다 — 나머지 여덟은 이어지는 태스크의
 * 몫이다. 그 여덟이 아직 없는 채로 이 테스트를 커밋하는 판단은
 * `.superpowers/sdd/2026-09-03-phase8-docs-ci/task-12-report.md`에 적는다.
 */
const REQUIRED_AGENTS_MD_PATHS = [
  'AGENTS.md',
  'src/config/AGENTS.md',
  'src/db/AGENTS.md',
  'src/db/migrations/AGENTS.md',
  'src/app/AGENTS.md',
  'src/app/jsonapi/AGENTS.md',
  'src/app/serializers/AGENTS.md',
  'src/app/controllers/concerns/AGENTS.md',
  'test/AGENTS.md',
];

/** `section`이 정본 검증 명령을 스펙과 같은 순서로, 문자 그대로 담는지 확인한다. */
function expectVerificationCommandsInOrder(section: string): void {
  for (const command of VERIFICATION_COMMANDS) {
    expect(section).toContain(command);
  }
  const positions = VERIFICATION_COMMANDS.map((command) => section.indexOf(command));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

/** 펜스(```) 코드 블록을 지운 텍스트를 돌려준다. 아래 `referencedPaths` 참고. */
function stripFencedCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/**
 * "경로로 본다"는 판정 규칙 — 무엇을 잡고 무엇을 놓치는지.
 *
 * 백틱 하나로 감싼, 줄바꿈 없는 인라인 코드 스팬만 후보로 보고, 그중 이 저장소의
 * 실제 최상위 디렉터리(`src/`·`test/`·`scripts/`·`docs/`) 또는 `./`로 시작하는
 * 것만 경로로 판정한다.
 *
 * 펜스 코드 블록은 먼저 지운다 — 블록 안 예시 코드의 첫 줄이 `src/`로 시작하면
 * (파일 트리 예시 등) 백틱 스캔이 블록 전체를 하나의 거대한 "경로"로 잘못 묶을 수
 * 있고, 그러면 `existsSync`가 당연히 그 문자열을 찾지 못해 오탐이 난다.
 *
 * 이 규칙이 놓치는 것: `api/v1/examples`처럼 슬래시가 있어도 URL 경로인 토큰이나
 * `EXAMPLE_QUERY_POLICY.sorts` 같은 식별자는 네 접두어 규칙 밖이라 애초에 후보에
 * 들지 않는다 — 이건 의도한 배제다(URL을 파일 경로로 오판하면 그게 오탐이다).
 * 반대로 저장소 루트의 `README.md`·`package.json`처럼 네 접두어로 시작하지 않는
 * 진짜 경로는 이 규칙 밖이라 이 테스트가 그 드리프트를 잡지 못한다 — 오탐 없는
 * 좁은 규칙을 택한 대가다.
 */
const PATH_PREFIXES = ['src/', 'test/', 'scripts/', 'docs/', './'];

function isPathCandidate(token: string): boolean {
  return PATH_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function referencedPaths(document: string): string[] {
  const withoutFences = stripFencedCodeBlocks(document);
  const paths: string[] = [];
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1];
    if (token !== undefined && isPathCandidate(token) && !paths.includes(token)) {
      paths.push(token);
    }
  }
  return paths;
}

describe('AGENTS.md 문서군', () => {
  it('스펙 14장이 요구한 아홉 개 AGENTS.md가 전부 있다', () => {
    for (const relativePath of REQUIRED_AGENTS_MD_PATHS) {
      expect(existsSync(absolute(relativePath))).toBe(true);
    }
  });

  it('README의 검증 절이 정본 검증 명령을 담는다', () => {
    const readme = readFileSync(absolute('README.md'), 'utf8');
    expectVerificationCommandsInOrder(extractSection(readme, '## 검증'));
  });

  it('루트 AGENTS.md의 검증 명령 절이 README와 문자 단위로 같은 정본을 담는다', () => {
    const agents = readFileSync(absolute('AGENTS.md'), 'utf8');
    expectVerificationCommandsInOrder(extractSection(agents, '## 검증 명령'));
  });

  it('각 AGENTS.md가 본문에서 가리키는 저장소 경로가 실재한다 (존재하는 문서만)', () => {
    // 아직 없는 여덟 문서는 여기서 건너뛴다 — 그 부재는 위 "아홉 개가 전부 있다"
    // 테스트가 잡는다. 이 테스트는 내용을 확인할 수 있는 문서만 본다.
    let checkedAtLeastOnePath = false;
    for (const relativePath of REQUIRED_AGENTS_MD_PATHS) {
      const path = absolute(relativePath);
      if (!existsSync(path)) {
        continue;
      }
      const content = readFileSync(path, 'utf8');
      for (const referenced of referencedPaths(content)) {
        checkedAtLeastOnePath = true;
        expect(existsSync(absolute(referenced))).toBe(true);
      }
    }
    // 위 루프가 아무 경로도 못 찾으면 "통과"가 "확인함"을 뜻하지 않게 된다 —
    // 최소 하나는 실제로 검사했는지를 별도로 확인해 이 테스트가 조용히 무력해지는
    // 것을 막는다.
    expect(checkedAtLeastOnePath).toBe(true);
  });
});
