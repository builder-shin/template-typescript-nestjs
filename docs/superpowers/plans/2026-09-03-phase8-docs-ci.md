# Phase 8: Docker/Compose/CI 마감과 `AGENTS.md` 문서군 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이 템플릿을 복제한 사람이 무엇을 어디서 고쳐야 하는지 알 수 있게 하고, 그 문서가 코드와 갈라지면 테스트가 잡게 한다.

**Architecture:** 스펙 14장이 정한 아홉 개 `AGENTS.md`를 쓴다. 각 파일은 자기 디렉터리의 **지역 계약**을 소유하고, 코드에서 읽어낼 수 있는 것을 되풀이하지 않는다. 문서 동기화 테스트가 파일의 존재, 검증 명령의 문자열 일치, 그리고 문서가 가리키는 경로의 실재를 고정한다.

**Tech Stack:** Markdown, Jest 30(문서 테스트), Docker Compose, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md` (13 검증 게이트, 13.1 npm scripts, 14 문서 구조, 15 테스트 전략, 17 구현 단계)

## 지금 이미 되어 있는 것 (확인함)

이 단계가 "마감"인 만큼, 남은 것이 정확히 무엇인지부터 실제로 확인했다.

- **CI는 이미 스펙 13장의 여섯 명령을 전부 돈다**(`.github/workflows/ci.yml`). `check.sh` 호출, compose config 검증, runtime 이미지 빌드, 스택 기동, `if: always()`로 정리까지. 손댈 것이 없다.
- **Dockerfile은 이미 builder/runtime 2단계**이고 비루트 사용자, `EXPOSE 4000`, `HEALTHCHECK`, `pnpm prune --prod`까지 되어 있다.
- **Compose는 db·redis·api·worker 네 서비스**가 있고 워커의 헬스체크 비활성 이유까지 주석에 있다.
- **`README.md`는 13개 절**을 갖췄고 `test/docs/readme.spec.ts`가 검증 명령·구조 경로·필수 환경 변수·마이그레이션 명령을 고정한다.

**그래서 이 단계에 남은 것은 셋이다:** 스펙 13.1의 `compose:verify` 스크립트, 스펙 14장의 아홉 개 `AGENTS.md`, 그리고 그 문서군을 지키는 동기화 테스트.

## 이 계획이 내리는 설계 결정

- **`AGENTS.md`는 코드가 말하는 것을 되풀이하지 않는다.** 함수 목록이나 파일 목록을 적으면 그 순간부터 낡기 시작하고, 아무 테스트도 그것을 잡지 못한다. 각 파일이 적을 것은 **코드에서 읽어낼 수 없는 것**이다 — 왜 그렇게 되어 있는지, 무엇을 건드리면 무엇이 깨지는지, 고칠 때 어떤 순서로 손대야 하는지.
- **`docs/superpowers/rulings/`가 그 재료다.** Phase 3~7의 룰링 문서 다섯 개에 "이 저장소가 실제로 겪은 사고와 그 이유"가 이미 쌓여 있다. `AGENTS.md`를 새로 지어내지 말고 거기서 캐내라 — 이미 값을 치르고 배운 것들이다.
- **문서 동기화 테스트는 지킬 수 있는 것만 지킨다.** 산문의 정확성은 테스트할 수 없다. 테스트할 수 있는 것은 (1) 스펙 14장이 요구한 파일이 다 있는가, (2) 검증 명령이 README와 루트 `AGENTS.md`에서 문자 단위로 같은가, (3) 문서가 가리키는 경로가 실재하는가다. **그 셋만 고정하고, 못 지키는 것을 지키는 척하지 않는다** — Phase 7에서 "필수 환경 변수를 **모두** 문서화한다"는 단언이 얼어붙은 부분집합만 세고 있어 두 변수를 놓친 사고가 있었다.
- **`compose:verify`는 스펙 13장의 여섯 명령 중 하나를 감싼다.** README의 `## 검증` 절은 여섯 명령을 **원문 그대로** 유지한다 — 스펙 13장이 그 목록을 문자 단위로 고정하고 문서 테스트가 그것을 지킨다. 스크립트는 편의 별칭이지 정본이 아니다.

## Global Constraints

- 문서는 **한국어**로 쓰고, 무엇이 아니라 **왜**를 적는다. `README.md`의 기존 어조와 구조를 따르고 새 문체를 들이지 않는다.
- **재지 않은 것을 잰 것처럼 쓰지 않는다.** 이 저장소는 "주석이 실측보다 앞서 나가는 것"을 결함으로 보고 Phase 7에서만 열네 건을 잡았다. 문서도 같은 기준이다.
- 문서가 코드의 특정 줄 번호를 가리키지 않는다 — 줄 번호는 즉시 낡는다. 파일과 심볼 이름으로 가리킨다.
- 테스트는 `TRUNCATE`나 조건 없는 `DELETE`를 쓰지 않는다.
- 이 프로젝트의 ESM Jest 설정은 `jest` 전역을 주입하지 않는다.
- `noUncheckedIndexedAccess`가 켜져 있다. `!`나 `as`로 지우지 않는다. ESLint는 `strictTypeChecked` + `stylisticTypeChecked`다.
- 커밋 메시지에 AI 관련 트레일러를 넣지 않는다. 저장소 소유자의 명시적 규칙이다.
- 모든 단계가 끝나면 `./scripts/check.sh`가 통과해야 한다.

---

## 이 계획이 만드는 파일

| 경로 | 책임 |
| --- | --- |
| `package.json` (수정) | `compose:verify` 스크립트 |
| `test/scripts/npm-scripts.spec.ts` | 스펙 13.1의 스크립트 표를 고정 |
| `AGENTS.md` | 아키텍처·DB 규칙·검증 명령·조립점과 변경 순서 |
| `test/docs/agents.spec.ts` | 문서군의 존재·명령 일치·경로 실재 |
| `src/config/AGENTS.md` | 팩토리·명시 route·DataSource 조립 |
| `src/db/AGENTS.md` | 호출자 소유 트랜잭션의 결정적 seed |
| `src/db/migrations/AGENTS.md` | DataSource 선택과 up/down |
| `src/app/AGENTS.md` | 모델·schema·serializer·controller 계층 책임 |
| `src/app/jsonapi/AGENTS.md` | 프로토콜 계약 |
| `src/app/serializers/AGENTS.md` | 공개 표현 규칙 |
| `src/app/controllers/concerns/AGENTS.md` | 공통 CRUD 계약과 concern별 검토 지점 |
| `test/AGENTS.md` | fixture와 계약별 회귀 테스트 배치 |
| `README.md` (수정) | 단계 상태와 문서 지도 |

---

### Task 1: `compose:verify` 스크립트와 스크립트 표 고정

**Files:**
- Modify: `package.json`
- Modify: `README.md` (개별 검사 절)
- Test: `test/scripts/npm-scripts.spec.ts`

**왜 필요한가:** 스펙 13.1의 표가 `db:up` / `worker` / `compose:verify` 셋을 이름으로 정하는데 `compose:verify`만 없다. Phase 7이 `worker`를 추가하며 그 표를 근거로 삼았으니, 같은 표의 나머지 한 칸을 비워 두지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/scripts/npm-scripts.spec.ts`. `package.json`을 읽어 스펙 13.1이 이름으로 정한 스크립트가 전부 있는지 고정한다. 목록은 스펙 13.1의 표에서 그대로 옮긴다 — `lint`, `format`, `format:check`, `typecheck`, `build`, `start`, `test`, `test:quick`, `test:jsonapi`, `test:controllers`, `test:db`, `migrate`, `seed`, `db:up`, `worker`, `compose:verify`, `check`.

또한 스펙 13.1이 명시한 두 가지를 고정한다.

- **`check`는 `./scripts/check.sh` 호출만 한다** — 스펙이 "`check`는 `./scripts/check.sh` 호출만 한다"고 정한다. 다른 것이 섞이면 CI와 로컬이 갈라지는 문이 열린다.
- **`check`를 제외한 스크립트는 bash 없이 Windows에서도 동작한다.** 문자열에 `&&`·`||`·`$(`·`|`·홑따옴표 같은 셸 의존 표기가 없는지 본다. **이 단언이 무엇을 잡고 무엇을 못 잡는지 주석에 적어라** — 문자열 검사는 "셸이 필요하다"의 근사이지 증명이 아니다.

`.spec.ts` 파일에서 `package.json`을 읽는 방법은 `test/docs/readme.spec.ts`가 파일을 읽는 방식을 그대로 따른다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/scripts/npm-scripts.spec.ts`
Expected: FAIL — `compose:verify`가 없다

- [ ] **Step 3: 스크립트를 더한다**

`package.json`의 `scripts`에 `db:up` 옆으로 더한다.

```json
"compose:verify": "docker compose config --quiet"
```

**README의 `## 검증` 절은 건드리지 않는다.** 그 절의 여섯 명령은 스펙 13장이 문자 단위로 고정하는 정본이고, `test/docs/readme.spec.ts`가 그것을 지킨다. `compose:verify`는 편의 별칭이므로 `## 개별 검사` 절에 한 줄로 소개한다.

- [ ] **Step 4: 통과를 확인하고 커밋한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/scripts/npm-scripts.spec.ts`

```bash
git add package.json README.md test/scripts/npm-scripts.spec.ts
git commit -m "feat(scripts): compose:verify를 추가하고 스크립트 표를 테스트로 고정"
```

---

### Task 2: 루트 `AGENTS.md`와 문서 동기화 테스트

**Files:**
- Create: `AGENTS.md`
- Test: `test/docs/agents.spec.ts`

**Interfaces:**
- Produces: 나머지 여덟 `AGENTS.md`가 따를 형태와, 그것들을 지킬 테스트

**이 태스크가 먼저인 이유:** 테스트가 먼저 있어야 뒤의 세 태스크가 무엇을 만족시켜야 하는지 알 수 있다. 다만 테스트는 아직 없는 파일을 요구하므로, **이 태스크가 끝나는 시점에는 여덟 개가 없어서 실패하는 상태가 정상이다.** 그것을 어떻게 다룰지는 아래 Step 2에서 정한다.

- [ ] **Step 1: 문서 동기화 테스트를 쓴다**

`test/docs/agents.spec.ts`. 고정할 것 셋:

1. **스펙 14장이 요구한 아홉 개 `AGENTS.md`가 전부 있다.** 경로 목록을 스펙 14장의 표에서 그대로 옮긴다.
2. **검증 명령이 README와 루트 `AGENTS.md`에서 문자 단위로 같다.** 스펙 14장이 `AGENTS.md`에 "검증 명령"의 소유권을 주고, 스펙 13장이 그 목록을 고정한다. `test/docs/readme.spec.ts`가 README 쪽에 쓰는 추출 방식을 재사용하되 — **그 파일의 헬퍼를 복사하지 말고 공유할 수 있으면 공유하라.** 두 벌이 되면 한쪽만 고쳐지는 날이 온다.
3. **각 `AGENTS.md`가 본문에서 가리키는 저장소 경로가 실재한다.** `readme.spec.ts`의 "구조 절에 적은 경로가 실제로 존재한다"가 쓰는 방식을 따른다. 무엇을 "경로로 본다"고 판정하는지가 이 단언의 전부이므로, 그 규칙을 주석에 적고 오탐이 나지 않을 만큼 좁게 잡아라.

**지키지 못하는 것을 지키는 척하지 마라.** 산문의 정확성은 테스트할 수 없다. Phase 7에서 "필수 환경 변수를 **모두** 문서화한다"는 단언이 얼어붙은 네 개짜리 목록만 세고 있어 두 변수를 놓쳤다 — 목록을 고정하는 단언을 쓸 때는 그 목록이 **어디서 오는지**를 함께 적고, 코드에서 유도할 수 있으면 유도하라.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/docs/agents.spec.ts`
Expected: FAIL — 아홉 개 중 여덟 개가 없다

**여기서 판단이 필요하다.** 이 태스크를 커밋하면 게이트가 빨간 상태로 남는다. 다음 중에서 고르고 이유를 보고하라 — (a) Task 2~5를 한 커밋으로 묶어 중간에 빨간 상태를 남기지 않는다, (b) 테스트를 먼저 커밋하되 나머지 여덟 개를 만드는 태스크가 곧바로 이어지므로 감수한다, (c) 다른 방법. **이 저장소는 Phase 4에서 "조립이 끝날 때까지 커버리지 게이트가 빨간 것"을 감수한 전례가 있다**(그때의 판단과 이유는 `docs/superpowers/rulings/2026-08-30-phase4-rulings.md`에 있다). 그 전례를 읽고 정하라.

- [ ] **Step 3: 루트 `AGENTS.md`를 쓴다**

스펙 14장이 이 파일에 주는 소유권은 넷이다 — **아키텍처, DB 규칙, 검증 명령, 조립점과 변경 순서.**

써야 할 것:

- **아키텍처**: 이 템플릿이 무엇을 흉내 내는가(참조 FastAPI 템플릿의 계약을 이식한 것), 계층이 어떻게 나뉘는가, 그리고 **자원별 service 계층을 만들지 않는다**는 결정과 그 이유.
- **DB 규칙**: 스키마 변경은 새 마이그레이션으로만 전달한다, 엔티티·마이그레이션·컨트롤러·시리얼라이저는 손으로 등록한다(glob 탐색이 없다), 정렬을 여는 변경과 인덱스를 만드는 변경은 같은 커밋에 둔다.
- **검증 명령**: 스펙 13장의 여섯 명령을 README와 **문자 단위로 같게** 적는다. 테스트가 그것을 지킨다.
- **조립점과 변경 순서**: 새 자원을 더할 때 어느 파일을 어떤 순서로 건드려야 하는지. 이것이 이 파일에서 가장 값이 큰 부분이다 — 나머지는 코드를 읽으면 알 수 있지만 **순서는 읽어서 알 수 없다.**

**재료는 지어내지 말고 캐내라.** `docs/superpowers/rulings/`의 다섯 문서에 이 저장소가 실제로 겪은 사고와 그 이유가 쌓여 있다. 특히 각 문서 끝의 "이 단계가 남긴 교훈" 절들이 이 파일에 들어갈 만한 것을 이미 정리해 두었다. 다섯 문서를 전부 읽고, **되풀이되는 것**을 골라라 — 한 번 난 사고보다 세 번 난 사고가 문서에 적힐 값이 크다.

- [ ] **Step 4: 커밋한다**

```bash
git add AGENTS.md test/docs/agents.spec.ts
git commit -m "docs: 루트 AGENTS.md와 문서군 동기화 테스트 추가"
```

---

### Task 3: 설정·DB 계층 `AGENTS.md` 셋

**Files:**
- Create: `src/config/AGENTS.md`, `src/db/AGENTS.md`, `src/db/migrations/AGENTS.md`

각 파일이 소유하는 것은 스펙 14장이 정한다.

- **`src/config/AGENTS.md` — 팩토리·명시 route·DataSource 조립.** 왜 `@nestjs/config`가 아니라 손으로 쓴 `settings.ts`인가(암묵적 기본값을 두지 않는다는 계약), 왜 라우트를 배열에 손으로 등록하는가, `AppModule`이 조립 시점에 설정을 읽어 시작 실패를 만드는 이유, 그리고 **`AppModule`이 닿는 그래프에 무엇을 넣으면 안 되는가**(broker — 실측 근거와 함께). `data-source.ts`가 CLI 전용으로 따로 있는 이유도.
- **`src/db/AGENTS.md` — 호출자 소유 트랜잭션의 결정적 seed.** seed가 결정적이어야 하는 이유와 그것을 어떻게 보장하는가, 트랜잭션을 누가 소유하는가.
- **`src/db/migrations/AGENTS.md` — DataSource 선택과 up/down.** 클래스명 끝의 epoch millis가 파일명과 같은 시각을 가리켜야 한다는 것(**이 저장소는 그것을 두 번 틀렸다 — 한 번은 하루, 한 번은 로컬 시각과 UTC의 날짜가 갈리는 순간**), `MIGRATIONS` 배열에 손으로 등록해야 한다는 것, `down()`이 실제로 실행된다는 것(`migration-revert.spec.ts`), 스키마 드리프트 검사가 무엇을 잡는가, 그리고 **엔티티에 없는 인덱스는 드리프트 검사가 지우려 든다**는 것.

**각 파일에 반드시 넣을 것:** 그 디렉터리를 고칠 때 **함께 고쳐야 하는 다른 파일**의 목록. 이 저장소가 반복해서 겪은 사고가 대부분 "한쪽만 고쳤다"이기 때문이다.

- [ ] **Step 1: 세 파일을 쓴다**
- [ ] **Step 2: 문서 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/docs`

- [ ] **Step 3: 커밋한다**

```bash
git add src/config/AGENTS.md src/db/AGENTS.md src/db/migrations/AGENTS.md
git commit -m "docs: 설정·DB 계층 AGENTS.md 추가"
```

---

### Task 4: 애플리케이션 계층 `AGENTS.md` 셋

**Files:**
- Create: `src/app/AGENTS.md`, `src/app/jsonapi/AGENTS.md`, `src/app/serializers/AGENTS.md`

- **`src/app/AGENTS.md` — 모델·schema·serializer·controller 계층 책임.** 각 계층이 무엇을 소유하고 무엇을 소유하지 않는가. 특히 **쓰기 스키마의 선택 필드 표기가 컬럼의 nullable 여부를 따라간다**는 규칙(`@IsOptional()`은 `null`에도 검증을 건너뛰므로 NOT NULL 컬럼에 달면 422여야 할 것이 500이 된다 — 이 저장소가 실제로 겪었다), 그리고 내부 FK를 공개 입력으로 만들지 않는다는 규칙.
- **`src/app/jsonapi/AGENTS.md` — 프로토콜 계약.** vendor 미디어 타입에 파라미터를 붙이지 않는다, 오류는 24개 카탈로그에서 고른다, 사용자 입력 오류는 `JsonApiError`이고 프로그래밍 오류는 `TypeError`다, 협상 가드가 본문 유무로 판정한다. **그리고 이 계층을 고칠 때 무엇을 함께 확인해야 하는가** — 오류 코드를 더하면 카탈로그 테스트가 개수를 세고, 문서가 그것을 적는다.
- **`src/app/serializers/AGENTS.md` — 공개 표현 규칙.** attributes에 열거된 것만 나간다는 것과 그것이 왜 안전장치인가(`passwordHash`가 새지 않는 이유가 그것이다), `resourcePath`가 선택인 이유(가리킬 라우트가 없는 자원은 링크를 지어내지 않는다), `SERIALIZERS` 배열이 실제로 담는 것(`included` 조립용 `ErasedSerializer`이지 "저장소가 아는 전부"가 아니다).

- [ ] **Step 1: 세 파일을 쓴다**
- [ ] **Step 2: 문서 테스트를 돌린다**
- [ ] **Step 3: 커밋한다**

```bash
git add src/app/AGENTS.md src/app/jsonapi/AGENTS.md src/app/serializers/AGENTS.md
git commit -m "docs: 애플리케이션 계층 AGENTS.md 추가"
```

---

### Task 5: concern과 테스트 `AGENTS.md` 둘

**Files:**
- Create: `src/app/controllers/concerns/AGENTS.md`, `test/AGENTS.md`

- **`src/app/controllers/concerns/AGENTS.md` — 공통 CRUD 계약과 concern별 검토 지점.** `CrudActions`가 라우트를 동적으로 만든다는 것과 그것이 무엇을 어렵게 하는가(손으로 데코레이터를 붙일 수 없어 `route-registrar`가 가드와 OpenAPI 표시를 같은 자리에서 붙인다), `writeGuards`가 붙는 라우트와 붙지 않는 라우트, `replace`가 형제와 달리 트랜잭션 **안**에서 재조회하는 이유, 그리고 **`presentKeys`가 무엇을 위해 존재하는가** — 이 저장소는 그것을 우회한 새 경로가 되돌림 로직을 통째로 도달 불가능하게 만든 사고를 겪었다.
- **`test/AGENTS.md` — fixture와 계약별 회귀 테스트 배치.** `withRollback(dataSource, fn)`의 시그니처(이 저장소의 계획들이 세 번 틀렸다), 커밋하는 스위트가 지켜야 할 규율(자기 접두사만 지운다, `TRUNCATE`·조건 없는 `DELETE`·`FLUSHALL` 금지, 스코프 없는 카운트 단언 금지), `acquireCommitLock`이 언제 필요한가와 언제 불필요한가, **`jest` 전역이 주입되지 않는다**는 것과 그 대안(`Logger.overrideLogger`, `Date.now` 교체), 그리고 스펙 15장의 회귀 작성 규칙.

**`test/AGENTS.md`에 반드시 넣을 것:** 이 저장소가 **두 번** 겪은 "동시성 테스트가 실은 동시성을 검증하지 않는다"는 사고와, 그것을 막는 방법(동시성 원시를 제거하고 테스트가 실제로 실패하는지 실측하라). 그리고 **"테스트가 초록인 이유를 확인하라"** — 운영 경로가 만들지 않는 입력 모양으로 테스트해 결함을 통과시킨 사례가 있다.

- [ ] **Step 1: 두 파일을 쓴다**
- [ ] **Step 2: 문서 테스트를 돌린다** — 이제 아홉 개가 전부 있으므로 초록이어야 한다.
- [ ] **Step 3: 게이트 전체를 돌린다**

Run: `./scripts/check.sh`
Expected: exit 0

- [ ] **Step 4: 커밋한다**

```bash
git add src/app/controllers/concerns/AGENTS.md test/AGENTS.md
git commit -m "docs: concern과 테스트 AGENTS.md 추가"
```

---

### Task 6: README 마감과 단계 완료 확인

**Files:**
- Modify: `README.md`
- Modify: `test/docs/readme.spec.ts` (필요하면)

- [ ] **Step 1: README에 문서 지도를 더한다**

아홉 개 `AGENTS.md`가 생겼으므로, README가 그것들을 가리켜야 한다 — 어느 디렉터리를 고칠 때 어느 문서를 먼저 읽어야 하는지. 스펙 14장의 표를 그대로 옮기되, **"소유하는 로컬 계약" 칸이 실제 파일 내용과 맞는지 확인하고** 다르면 어느 쪽이 맞는지 판정해 보고하라.

- [ ] **Step 2: 단계 상태를 마감한다**

Phase 0~8이 전부 끝났으므로 진행 상태 표기를 갱신한다. **"아직 구현되지 않은 것" 줄을 어떻게 할지 판단하라** — 스펙 17장의 여덟 단계가 전부 끝났다면 그 줄은 이제 거짓이다. 지울지, "없다"로 바꿀지, 스펙 1.1의 비목표(YAGNI로 뺀 것들)를 가리키게 할지 정하고 이유를 보고하라.

- [ ] **Step 3: 스펙 전체를 훑어 빠진 것이 없는지 확인한다**

이 단계가 마지막이므로, **스펙의 각 장이 실제로 구현되었는지 한 번 훑어라.** 빠진 것이 있으면 고치지 말고 **보고하라** — 그것이 이 단계의 범위인지 아닌지는 내가 판정한다. 특히 확인할 것:

- 스펙 16장의 공개 API 표면 표에 있는 라우트가 전부 존재하는가.
- 스펙 12장의 환경 변수 표가 전부 구현되고 문서화되었는가.
- 스펙 13.1의 스크립트 표가 전부 있는가.
- 스펙 14장의 문서군이 전부 있는가.
- 스펙 3장의 디렉터리 구조와 실제 트리가 어긋나는 곳이 있는가(**있다 — `src/config/auth.ts`가 그 예다. Phase 6이 JWT 설정을 `settings.ts`에 두었다. 이런 것을 찾아 목록으로 보고하라.**)

- [ ] **Step 4: 게이트를 돌리고 커밋한다**

Run: `./scripts/check.sh` 그리고 `pnpm run compose:verify`

```bash
git add README.md test/docs/readme.spec.ts
git commit -m "docs: 문서 지도와 단계 상태를 마감한다"
```

---

## 자체 점검

**스펙 13.1 대응:** `compose:verify`(Task 1). 나머지 열여섯 개는 이미 있고 Task 1의 테스트가 전부를 고정한다.

**스펙 14장 대응:** 아홉 개 `AGENTS.md`(Task 2~5)와 README의 문서 지도(Task 6). `docs/superpowers/specs/`·`plans/`는 이미 있다.

**스펙 15장 대응:** `test/docs/`가 "README와 AGENTS.md의 명령 문자열 동기화"를 검증한다(Task 2).

**스펙 13장·17장 대응:** CI와 Docker/Compose는 이미 여섯 명령을 전부 돈다 — 이 단계가 확인만 하고 손대지 않는다(Task 6 Step 3).

**이 계획이 다루지 않는 것:** 스펙 1.1의 비목표(멀티테넌시, 이벤트 소싱 등). 성능 튜닝. 배포 파이프라인. 이 저장소를 실제로 복제해 새 자원을 만들어 보는 종단 검증 — 값은 있지만 이 단계의 범위가 아니고, 문서가 그것을 안내하는 것으로 대신한다.
