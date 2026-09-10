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

  it('각 AGENTS.md가 본문에서 가리키는 저장소 경로가 실재한다', () => {
    for (const relativePath of REQUIRED_AGENTS_MD_PATHS) {
      const content = readFileSync(absolute(relativePath), 'utf8');
      const referenced = referencedPaths(content);
      // 문서 하나가 아무 경로도 참조하지 않으면 "통과"가 "그 문서를 확인함"을
      // 뜻하지 않게 된다 — 아홉 개를 합쳐 하나만 찾으면 통과하는 집계였다면,
      // 여덟 개가 채워 주는 참조 뒤에서 나머지 하나가 통째로 비어도(또는 경로
      // 참조가 하나도 없는 산문으로 바뀌어도) 조용히 통과한다. 문서마다 따로
      // 확인해 그 구멍을 막는다.
      expect(referenced.length).toBeGreaterThan(0);
      for (const path of referenced) {
        expect(existsSync(absolute(path))).toBe(true);
      }
    }
  });
});
