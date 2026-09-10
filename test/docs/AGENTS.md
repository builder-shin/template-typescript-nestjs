<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/docs

## 목적

README와 필수 AGENTS.md 문서가 실제 저장소 경로 및 정해진 검증 명령을 유지하는지
정적으로 검사한다. 검증 명령의 문자열 정본도 이곳에서 공유한다.

## 주요 파일

| 파일                                               | 설명                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [verification-section.ts](verification-section.ts) | 전체 검증 명령 배열과 지정한 2단계 제목의 절만 추출하는 함수를 제공한다.                      |
| [agents.spec.ts](agents.spec.ts)                   | 필수 AGENTS.md 아홉 경로, README·루트 AGENTS의 명령 순서, 문서별 저장소 경로 참조를 검사한다. |
| [readme.spec.ts](readme.spec.ts)                   | README 구조 경로, 검증 명령, ESM·.js 설명, 환경 변수와 migrate·seed 안내를 검사한다.          |

## AI 에이전트 지침

- 검증 명령을 바꾸면 VERIFICATION_COMMANDS, README의 검증 절, 루트 AGENTS의
  검증 명령 절을 함께 맞춘다. 두 문서는 서로가 아니라 같은 배열과 각각 비교한다.
- extractSection은 해당 제목부터 다음 2단계 제목 전까지를 본다. 다른 절에 우연히
  존재하는 명령으로 검사를 통과시키지 않는다.
- README 구조 파서는 text 코드 블록 각 줄의 첫 공백 구분 토큰을 경로로 읽는다.
  구조 표기 형식을 바꾸면 이 파서도 검토한다.
- agents 검사는 정해진 아홉 문서만 읽는다. 코드 블록 밖의 인라인 코드에서
  src/·test/·scripts/·docs/·./로 시작한 값을 저장소 경로로 보므로, 그 자리에
  존재하지 않는 glob이나 명령 전체를 넣지 않는다.
- 이 검사는 모든 하위 AGENTS 링크·Parent 태그를 순회하지 않는다. 문서 계층 생성 시
  별도 링크 검증이 필요하며, 테스트 통과를 문서 내용 전체의 정확성으로 보고하지 않는다.
- 새 필수 환경 변수는 README와 readme.spec의 명시 목록을 함께 갱신한다.
  새 공개 자원의 README API 표는 현재 검사 범위에 없으므로 직접 검토한다.

## 검증

저장소 루트에서 실행한다. 문서를 읽는 검사이므로 DB·Redis·Docker는 필요 없다.
문서 변경에는 형식·링크·secretlint 검사도 수행한다.

```bash
pnpm test:quick --runInBand test/docs
pnpm format:check
pnpm secretlint
```

## 의존성

README.md, 루트·계층 AGENTS.md와 문서가 참조한 저장소 경로에 의존한다.
Jest와 Node fs·path·url을 사용한다. 공통 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
