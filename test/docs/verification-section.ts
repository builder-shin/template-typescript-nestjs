/**
 * 스펙 13장이 정한 전체 검증 명령. README `## 검증` 절과 루트 `AGENTS.md` `## 검증 명령`
 * 절 둘 다 이 목록을 문자 단위·같은 순서로 담아야 하는 정본이다.
 *
 * 두 문서를 서로 비교하지 않고 각각 이 배열과 비교한다 — 둘 다 이 정본과 같으면
 * 서로도 같을 수밖에 없고, 실패했을 때 "README가 스펙과 다른가, AGENTS.md가
 * 스펙과 다른가"를 바로 구분할 수 있다.
 */
export const VERIFICATION_COMMANDS = [
  'pnpm install --frozen-lockfile',
  './scripts/check.sh',
  'docker compose config --quiet',
  'docker build --target runtime --tag template-typescript-nestjs:verify .',
  'docker compose up -d --build --wait',
  'docker compose down -v',
];

/**
 * 마크다운 문서에서 `heading`(예: `## 검증`)으로 시작하는 절의 본문만 잘라낸다.
 *
 * 다음 `\n## ` 이전까지를 절 본문으로 본다. 같은 명령 문자열이 다른 절
 * (`## Docker로 실행`, `## 개별 검사` 등)에도 자연스럽게 등장할 수 있으므로, 문서
 * 전체가 아니라 이 절 안에서만 순서와 존재를 확인해야 한다.
 */
export function extractSection(document: string, heading: string): string {
  const start = document.indexOf(heading);
  if (start < 0) {
    return '';
  }
  const rest = document.slice(start + heading.length);
  const next = rest.indexOf('\n## ');
  return next < 0 ? rest : rest.slice(0, next);
}
