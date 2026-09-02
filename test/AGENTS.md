# test/ — fixture와 회귀 배치

무엇을 어디에 쓰는가의 표(경로별 검증 대상, 회귀 작성 규칙)는 스펙 15장
(`docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md`)이 정본이다.
이 문서는 그 표를 옮겨 적지 않고, 표만으로는 보이지 않는 것 — 이 저장소의
fixture(`test/db/fixture.ts`)가 왜 이런 모양인지, 그리고 여기서 실제로 결함을
통과시켰던 테스트들이 무엇을 놓쳤는지 — 를 적는다.

## DB가 필요한 테스트와 필요 없는 테스트의 경계

`test/controllers/`와 `test/integration/`은 둘 다 `src/app/controllers/concerns/`를
검증하지만 기준이 다르다. `test/controllers/crud-actions.spec.ts`의 머리말이 그
기준을 그대로 적어 둔다 — "조립 시점 검사만 확인한다. […]
DB가 필요 없는 것은 이 검사들이 모두 팩토리 호출 자체에서 끝나기 때문이다." `CrudActions(declaration)`
호출만으로 판정되는 것(cardinality 불일치, `resourcePath` 불일치, 라우트 등록
자체)은 `test/controllers/`가 DB 없이 본다. 실제 요청이 오가야만, 또는 실제
트랜잭션·커넥션이 있어야만 참인지 알 수 있는 것은 `test/integration/`이 진짜
PostgreSQL로 본다.

이 경계를 넘어서 있는 척하는 테스트가 실제로 있었다. `crud-transaction.spec.ts`의
머리말이 기록한 사고다 — "관계 대상을 못 찾으면 자원도 만들지 않는다"는 테스트는
트랜잭션 경계를 증명하는 것처럼 보이지만, `create()`의 관계 해석이 `save()`
**이전에** 끝나므로 트랜잭션 래퍼를 통째로 지워도 그 테스트는 그대로 통과한다 —
실패가 애초에 `save()`를 부르기 전에 나기 때문이다. 저장 **후**에 실패하는
경로만이 롤백을 실제로 관찰할 수 있다. 이 저장소는 그래서 `afterSave`가 항상
던지는 프로브 컨트롤러를 따로 만들어 이 경로를 증명한다. 어떤 계약이 "DB가 있어야
증명된다"고 주장한다면, 그 증명이 실패를 만드는 실제 지점을 지나는지부터
확인한다 — 아래 "테스트가 초록인 이유" 절이 이 원칙의 일반형이다.

## `withRollback(dataSource, fn)` — 인자 두 개, 그리고 격리해 주지 않는 것

시그니처는 `withRollback(dataSource, fn)`이다. 이 저장소의 계획 문서 자신이 한
단계 안에서만 `withRollback(fn)`으로 세 번 틀렸다(`docs/superpowers/rulings/2026-09-02-phase6-rulings.md`) —
`dataSource`를 받지 않으면 애초에 전용 `queryRunner`를 열 수 없으니 컴파일이 되지
않는데도 계획 텍스트에는 세 번 반복해서 나타났다. 손으로 새 스펙을 쓸 때 가장
흔하게 틀리는 자리이니 기억해 둔다.

`withRollback`이 하는 일은 콜백을 트랜잭션 안에서 돌리고 **항상** 롤백하는
것뿐이다 — 성공해도 커밋하지 않는다. 이것이 주는 격리는 한 방향뿐이다: 이
함수로 감싼 테스트가 만든 행은 다른 테스트에게 보이지 않는다. 반대 방향은 주지
않는다 — `withRollback`은 READ COMMITTED 트랜잭션이므로 **다른 커넥션이 이미
커밋한 행**은 이 트랜잭션 안에서도 그대로 보인다. "이 블록 안에서는 내가 만든
행만 존재한다"고 가정하면 안 된다. 아래 두 절이 이 사실 위에 서 있다.

## 커밋하는 스위트의 규율 — 자기 접두사만 지운다

`Location` 헤더, advisory 잠금, 워커의 실제 처리처럼 커밋 이후만 관찰할 수 있는
계약은 `withRollback`을 쓰지 않고 실제로 커밋한 뒤 손으로 지운다. 규율은 하나다
— **자기가 만든 것만, 자기만 아는 이름으로 지운다.**

- 만든 행의 id를 배열에 적립해 `WHERE id = ANY($1)`로 지운다
  (`test/integration/examples-api.spec.ts`).
- id를 적립하기 마땅치 않은 자원(계정 등)은 스위트 전용 접두사·고정값으로 지운다
  (`WHERE email LIKE 'examples-api-%'`, 또는
  `refresh-session-concurrency.spec.ts`처럼 스위트 전용 고정 이메일 하나).
- `TRUNCATE`와 조건 없는 `DELETE`는 쓰지 않는다. 예전에 `truncateAll`이 있었지만
  실제 사고로 지워졌다 — 다른 스펙이 실제 HTTP로 행을 커밋하기 시작하면서,
  `TRUNCATE`는 워커 경계를 넘어 남의 커밋 행까지 지우고 `ACCESS EXCLUSIVE`
  잠금으로 다른 워커의 읽기까지 막는 위험이 됐다(`test/db/fixture.ts`의
  `withRollback` 문서, `test/integration/migrations.spec.ts`의 "스키마 제약"
  describe가 이 판단을 기록한다). 조건 없는 `DELETE`도 같은 이유로 다른
  워커(예: 같은 순간 동일 id로 커밋 중인 다른 PUT 시나리오)가 막 커밋한 행을
  지운다 — 이것도 실제로 겪은 사고다.
- Redis에 커밋하는 스위트도 같다. 이름이 고정된 프로덕션 큐를 쓰는 테스트는
  `FLUSHALL`이 아니라 자기가 넣은 잡만 `job.remove()`로 되돌리고, 스위트 전용
  이름으로 새로 만든 큐만 `queue.obliterate()`로 통째로 지운다
  (`test/integration/jobs-queue.spec.ts`) — `FLUSHALL`은 같은 Redis를 쓰는 다른
  워커·개발자의 키까지 지운다.
- **공유 테이블에 대한 스코프 없는 count·list 단언을 쓰지 않는다.** 자기 행을
  전부 지웠어도, "테이블 전체가 몇 개인가/비었는가"를 묻는 단언은 그 순간 다른
  커밋 스위트가 무엇을 갖고 있든 흔들린다. 실제로 흔들렸다 —
  `query-compiler.spec.ts`는 `withRollback` 스위트라 스스로는 아무것도
  커밋하지 않지만, `jobs-queue.spec.ts`가 워커 처리를 증명하려고 커밋한
  `Example` 행을 READ COMMITTED 아래에서 그대로 봐서 `isNull` 필터 단언이
  기대 2, 실제 3으로 흔들렸다(`check.sh` 일곱 번 중 한 번 재현). 고치는 법은
  잠금을 더 넓히는 것이 아니라 **읽는 쪽을 스스로 안전하게 만드는 것**이다 —
  `list()` 헬퍼를 `id IN (:...ids)`로 좁혀 이 스위트가 만든 행 밖의 무엇이
  테이블에 있든 결과가 흔들리지 않게 했다. `seeds.spec.ts`도 같은 이유로
  세 단언을 `In(SEED_*_IDS)`로 좁혔다.

## `acquireCommitLock` — 언제 잡고 언제 안 잡는가, 그리고 잡은 쪽끼리만 지킨다는 것

이 잠금이 필요한 조건은 하나다 — **같은 공유 테이블에 커밋하는 스위트가
둘 이상이고, 그중 하나가 자기 행으로 좁힐 수 없는 단언(빈 컬렉션, 총 개수처럼
"테이블 전체"를 묻는 것)을 한다.** `examples-api.spec.ts`와
`examples-put.spec.ts`가 이 조건이다 — 둘 다 `examples`/`categories`/`tags`에
커밋하고, 한쪽이 "빈 컬렉션도 data가 배열이다" 같은 테이블 전체 단언을 한다.
`purge-refresh-sessions-contention.spec.ts`와 `purge-refresh-sessions.spec.ts`도
서로에 대해 이 잠금을 잡는데 이유가 다르다 — 이 둘이 검증하는
`purgeExpiredRefreshSessions` 자체가 `expires_at < 커트라인`으로 테이블 전체를
보는 연산이라 이메일·사용자로 스코프할 수 없고, 계약을 확인하려면 두 스위트
모두 `expires_at`을 의도적으로 과거로 만들어 커밋해야 한다 — 그런 행이 병렬
워커에서 동시에 테이블에 있으면 한쪽의 purge 호출이 다른 쪽이 시나리오를 위해
막 커밋한 행을 먼저 지워 버릴 수 있다. 반대로 나머지 다섯 커밋 스위트(로그인 등)는
이 잠금이 필요 없는데, 접두사가 겹치지 않아서가 아니라 그 행들의 `expires_at`이
언제나 커트라인보다 한참 미래(최소 1시간, 보통 30일 뒤)라 시간 산술적으로 애초에
이 잡의 대상이 될 수 없기 때문이다 — 스코프 밖에 있는 이유가 매번 "접두사가
다르다"로 같지 않다는 뜻이다.

반대로 `refresh-session-concurrency.spec.ts`는 `users`/`refresh_sessions`에 두
커넥션으로 실제 커밋하면서도 이 잠금을 잡지 않는다 — 이 테이블에 커밋하는
다섯 스위트 모두 서로 겹치지 않는 접두사·고정값을 쓰고, 다섯 중 어디도
"테이블 전체"를 단언하지 않기 때문이다(`GET /users` 같은 컬렉션 라우트 자체가
없다). 잠금이 막아 줄 간섭이 애초에 없으므로 잡으면 병렬성만 잃는다.

늦게 배운 것 하나: **이 잠금은 그것을 잡은 쪽끼리만 줄을 세운다.** 잡지 않은
스위트는 애초에 이 잠금의 보호 대상이 아니다 — `query-compiler.spec.ts`가
`acquireCommitLock`을 잡지 않았던 것은 "잡을 이유가 없어서"(스스로는 아무것도
커밋하지 않으므로)였지만, 그 판단은 "다른 커밋 스위트가 이 잠금을 잡고 있으면
안전하다"는 것과는 다른 질문이었다 — `jobs-queue.spec.ts`가 잠금을 정확히 잡고
있어도 `query-compiler.spec.ts`는 그 잠금을 잡지 않으므로 조금도 보호받지
못한다. 잠금 판단이 옳은가와 그 판단이 지키는 범위가 무엇인가는 다른 질문이다
(`docs/superpowers/rulings/2026-09-02-phase7-rulings.md`).

## 동시성 테스트가 실은 동시성을 검증하지 않을 수 있다

이 저장소가 두 번 겪었고, 다섯 개 룰링 문서를 통틀어 가장 널리 적용되는 교훈이
하나 있다면 이것이다 — **동시성 원시를 지운 채로 테스트를 여러 번 돌려서,
정말로 실패하는지 실측하라.** 통과하면 그 테스트는 주석이 주장하는 것을 검증하지
않는다.

- **`examples-put.spec.ts`("같은 id로 동시에 들어온 두 요청이 섞이지 않는다").**
  `upsertRow`의 `pg_advisory_xact_lock` 줄을 비활성화한 채 2-way 8회·4-way 15회
  돌려도 전부 통과했다. 원인은 `upsertRow`의 `INSERT ... ON CONFLICT`가 트랜잭션의
  첫 DB 접근이라 PostgreSQL 자신의 행 잠금이 advisory 잠금보다 먼저, 그리고 이미
  두 트랜잭션을 끝까지 직렬화하고 있었기 때문이다. 잠금은 지우지 않았다 — 스펙
  7.2가 요구하고, 언젠가 upsert **앞에** DB 접근이 생기면(훅, 사전 확인 등) 행
  잠금이 너무 늦게 걸린다. 대신 이 레이스 테스트가 advisory 잠금의 증거가 될 수
  없다는 것을 인정하고, 잠금 자체가 걸리고 풀리는지는
  `test/integration/upsert-executor.spec.ts`가 `pg_locks`를 `pg_backend_pid()`로
  좁혀 직접 본다 — 레이스가 아니라 존재 확인으로.
- **`refresh-session-concurrency.spec.ts`("동시에 두 트랜잭션이 같은 세션을
  회전하면 하나만 성공하고 나머지는 TOKEN_REVOKED다").** `rotateSession`의
  `FOR UPDATE`를 지워도 기존 "이미 회전한 세션" 테스트는 여전히 통과했다 — 그
  테스트가 `withRollback`의 단일 트랜잭션 안에서 `rotateSession`을 **순차**
  호출했을 뿐이라 애초에 경합이 성립하지 않았기 때문이다. 진짜 경합을 만들려고
  이 스위트를 새로 썼다 — 서로 다른 `QueryRunner` 두 개로 각자 트랜잭션을 열고,
  두 `rotateSession` 호출을 어느 쪽도 기다리지 않은 채 띄운 뒤, A를 먼저
  커밋해야 B의 `SELECT ... FOR UPDATE`가 풀리도록 순서를 결정론적으로 만들었다.
  이렇게 만든 뒤에야 잠금을 지우면 4회 연속 실패, 넣으면 9회 연속 통과가
  실측됐다.

일반화하면: 신뢰할 수 있는 동시성 테스트는 서로 다른 커넥션·서로 다른
트랜잭션에서 서로를 기다리지 않고 띄운 두 호출과, 원하는 인터리빙을 강제하는
결정론적 장치(한쪽을 먼저 커밋해야 다른 쪽이 풀리게 만드는 것 등)를 요구한다.
`withRollback`의 단일 트랜잭션 안에서 순차로 부르는 것은 그 요구를 만족하지
못한다 — 겉보기에 "동시" 시나리오를 흉내 내는 이름을 붙여도 마찬가지다.

## 테스트가 초록인 이유를 확인하라 — 운영 경로가 만들지 않는 입력 모양

동시성과 별개로, 입력의 **모양**이 달라서 결함을 통과시킨 사고도 있었다.
`src/app/controllers/concerns/AGENTS.md`가 적은 `presentKeys` 사고가 그것이다 —
`replacementValues`의 되돌림 사다리가 실제 요청 경로에서 통째로 도달 불가능했는데,
당시 단위 테스트는 `attributes`로 순수 객체 리터럴(`{ title: '제목' }`)을 그대로
넘기고 있었다. 리터럴은 안 쓴 키를 아예 갖지 않으므로 "보내지 않은 키가 없다"는
성질이 우연히 성립했고, 실제 요청 경로가 넘기는 `plainToInstance` 인스턴스(이
tsconfig의 `useDefineForClassFields`로 인해 스키마가 소유한 프로퍼티 전부가
`undefined` 값으로라도 **존재하는** 객체)와는 근본적으로 다른 모양이었다 — 그래서
그 결함을 볼 수 없었다.

`test/integration/upsert-executor.spec.ts`의 `parse` 헬퍼가 이 회귀를 기억하는
방식이다 — `attributes`는 `plainToInstance(Schema, raw)`로, `presentKeys`는
`new Set(Object.keys(raw))`로 만든다. 이 디렉터리에서 어떤 함수가 "이 필드가
스키마 인스턴스에 존재하는가"가 아니라 "요청이 이 필드를 실제로 보냈는가"를
판정해야 할 때, 그 판정을 손으로 만든 객체 리터럴로 테스트하면 그 테스트는 애초에
운영이 만들지 않는 입력을 검증하는 것이다. `plainToInstance`가 만드는 것과 같은
모양을 만들어야 한다.

## `jest` 전역이 주입되지 않는다

이 프로젝트의 ESM + `--experimental-vm-modules` 조합에서는 `jest` 전역이 테스트
모듈에 주입되지 않는다 — `describe`/`it`/`expect`는 주입되지만 `jest`는 아니다
(Jest의 공식 ESM 가이드가 `@jest/globals`에서 명시적으로 import하라고 권하는 것도
이 때문이다). 이 저장소는 그 패키지를 새 의존성으로 들이지 않고, `jest.fn`·
`jest.spyOn`·`jest.useFakeTimers()` 대신 실제 프레임워크 상태를 직접 조작한다.

- **로그를 가로챌 때** — `Logger.overrideLogger({...})`. Nest `Logger`가 공개한
  정적 API이고, 인스턴스의 `localInstance` getter가 호출마다 이 정적 참조를
  다시 읽으므로 이미 만들어진 인스턴스에도 적용된다
  (`test/health.controller.spec.ts`, `test/jsonapi/exception-filter.spec.ts`).
- **시각을 고정할 때** — 전역 `Date.now`를 직접 바꿔치기한다. `jsonwebtoken`의
  `verify.js`가 `clockTimestamp` 옵션이 없으면 검증 시점에 `Date.now()`를 직접
  부른다는 것을 소스로 확인하고 그 호출 하나를 겨냥한 것이다(`test/auth/tokens.spec.ts`).

둘 다 정적/전역 상태를 건드리므로 원래 값을 변수에 잡아 두고 **반드시**
되돌린다 — `Logger.overrideLogger`는 `afterAll`에서 `new ConsoleLogger()`로,
`Date.now`는 그 호출을 감싼 `try`의 `finally`에서. 되돌리지 않으면 같은 파일의
다음 `describe`나 같은 워커의 다음 파일로 상태가 샌다.

## 스펙 15장의 회귀 작성 규칙

- HTTP 변경은 status·`Content-Type`·top-level 모양·오류 code와 source를 함께
  단언한다. `Accept-Language`를 건드리면 ko/en 모두 확인한다.
- 새 query 허용 항목은 정상 요청과 거부 요청을 모두 쓴다.
- 관계 변경은 cardinality, linkage type·id 오류, 없는 대상, 204, 롤백을 다룬다.
- `PUT` 변경은 201+`Location`, 200 교체, 동일 ID 동시 요청, 관계 reset, 훅/직렬화
  실패 롤백을 실제 PostgreSQL에서 검증한다 — "동일 ID 동시 요청"이 구체적으로
  어떤 모양이어야 하는지는 위 "동시성 테스트" 절이 다룬다.

## 함께 고쳐야 하는 파일

- **새로 실제 커밋하는 통합 스펙을 추가할 때.** 같은 공유 테이블에 이미
  커밋하는 스위트가 있는지 먼저 확인한다. 있고 그중 하나라도 테이블 전체를
  묻는 단언을 한다면(또는 새 스위트 자신의 연산이 자기 행으로 좁혀지지
  않는다면) `acquireCommitLock`을 잡는다. 없거나 전부 스코프된 단언만 한다면
  잡지 않는다 — 잡으면 병렬성만 잃는다. 정리 범위(id 목록 또는 스위트 전용
  접두사)를 함께 정한다.
- **동시성을 주장하는 테스트를 추가할 때.** 그 primitive를 지운 채로 여러 번
  돌려 실제로 실패하는지 먼저 확인한다. `withRollback`의 단일 트랜잭션 안
  순차 호출로는 경합을 만들 수 없으므로, 진짜 경합이 필요하면 별도
  `QueryRunner` 두 개로 커밋하는 스위트를 쓴다.
- **"보냈는가"를 판정하는 함수를 단위 테스트로 덮을 때.** 손으로 만든 객체
  리터럴이 아니라 `plainToInstance(Schema, raw)` + `new Set(Object.keys(raw))`로
  실제 요청 경로와 같은 입력 모양을 만든다.
- **README/`AGENTS.md`의 검증 명령을 바꿀 때.** `test/docs/verification-section.ts`의
  `VERIFICATION_COMMANDS`가 정본이다 — 이 배열 하나를 고치면
  `test/docs/agents.spec.ts`와 `test/docs/readme.spec.ts` 둘 다 그것과 각자
  비교해 README와 루트 `AGENTS.md`가 같은 정본에서 벗어났는지를 잡는다. 두
  문서를 직접 고치는 것만으로는 이 배열이 갱신되지 않는다.
