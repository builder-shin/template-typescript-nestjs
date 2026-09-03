# src/app/controllers/concerns/ — 공통 CRUD 계약

이 디렉터리는 다섯 개의 고정 액션(index/show/create/update/destroy)과 조건부 액션
(`enableUpsert`일 때의 `replace`), 그리고 관계 라우트를 `CrudActions` 하나로 조립하는
기계 장치를 소유한다. 계층 소유권 표는 루트 `AGENTS.md`의 "아키텍처" 절에 있으니
반복하지 않는다.

다만 이 디렉터리가 `CrudActions`만 있는 것은 아니다. `documents.ts`의 응답 조립,
`document-parsing.ts`의 요청 파싱, `relationship-resolver.ts`의
`unwritableRelationshipError`는 `src/app/controllers/api/v1/auth.controller.ts`와
`src/app/controllers/api/v1/users.controller.ts`처럼 `CrudActions`를 아예 쓰지 않고
라우트를 손으로 쓰는 컨트롤러도 낱개로 가져다 쓴다 — 디렉터리 이름이 "crud"가 아니라
"concerns"인 이유다. 이 문서는 그중 조립 기계 자체(`crud-actions.ts`·
`route-registrar.ts`·`upsert-executor.ts`)에 집중한다.

## `CrudActions`가 라우트를 동적으로 만드는 이유, 그리고 그것이 강제하는 것

`CrudActions(declaration)`이 돌려주는 `CrudActionsHost` 클래스는 함수 안에서
선언된다. 관계 라우트(`showRelationship$<name>` 등)는 존재 여부와 이름이
`declaration.serializer.relationships`로, 그중 어떤 것이 쓰기까지 여는지는
`declaration.relationshipsSchema`로 정해지는데 둘 다 `CrudActions`가 **호출되는
순간**에야 값을 안다 — 소스에 미리 `@Get('...')`을 적어 둘 이름 자체가 없다.
`route-registrar.ts`는 그래서 `Object.getOwnPropertyDescriptor`로 메서드를 찾아
데코레이터를 함수로 호출해 붙인다(`decorate` 헬퍼).

고정된 다섯 액션까지 같은 방식을 쓰는 것은 선택이지 필연은 아니다. 다만 관계
라우트처럼 정말 동적인 라우트가 이미 섞여 있는 이상, 고정 라우트만 소스에
데코레이터로 남겨 두면 "이 클래스의 라우트가 전부 무엇인가"를 아는 곳이 소스의
데코레이터와 `registerRoutes`의 동적 등록 둘로 갈린다. 하나(`registerRoutes`)로
몰아 둔 덕에 **가드와 OpenAPI 보안 표시가 같은 자리에서 결정된다** —
`guardWrites`가 이 함수 자신이 조립한 `writeMethods` 목록을 순회하며
`UseGuards(...guards)`와 `ApiBearerAuth()`를 같은 `decorate()` 호출 안에서 함께
붙인다. 이 둘을 각자 다른 자리에서 계산했다면 한쪽만 갱신되는 날이 오고, 그러면
OpenAPI 문서가 실제로 가드가 붙은 라우트를 공개라고 광고하거나 그 반대가 된다.

## `writeGuards`가 닿는 라우트, 닿지 않는 라우트

`writeMethods`는 `create`·`update`·`destroy`로 시작해 `enableUpsert`면 `replace`가,
`relationshipsSchema`에 있는 관계마다 `updateRelationship$<name>`이, cardinality가
`many`인 관계마다 `addRelationship$<name>`·`removeRelationship$<name>`이 더해진다.
`index`·`show`·`showRelationship$<name>`·`showRelated$<name>`은 이 목록에 **절대**
들어가지 않는다 — `serializer.relationships`가 선언한 모든 관계에 대해 무조건
만들어지고, 그 등록 경로는 `writeMethods`를 참조하지도 않는다.

그래서 "읽기는 공개, 쓰기는 인증"은 우연이 아니라 배열 하나가 두 갈래로 갈리는
지점에서 나오는 계약이다. `test/controllers/route-registrar.spec.ts`의
`writeGuards` describe가 이것을 실측한다 — 모든 요청을 막는 가드를 붙이고도
`GET`은 200, `POST`는 403이어야 한다고 단언한다. 새 액션이나 관계 라우트를 더할
때는 그것이 `writeMethods`에 들어가야 하는지부터 정하고, 그 판단이 이 목록
하나에만 반영되는지 확인한다 — 두 번째 판단 지점을 만들면 그 지점은 언젠가
`writeMethods`와 갈린다.

## `replace`가 형제와 달리 트랜잭션 안에서 재조회하는 이유

`create`/`update`는 커밋 뒤에 `findOne`으로 다시 읽어 응답을 만든다. `replace`는
같은 트랜잭션 **안**에서 재조회한다. 스펙 7.2가 요구하는 "동일 ID 동시 요청
직렬화"는 `upsertRow`의 `pg_advisory_xact_lock`(트랜잭션 스코프)이 보장하는데, 이
잠금은 커밋과 동시에 풀린다. 재조회를 커밋 뒤로 옮기면 그 읽기는 잠금이 이미
풀린 다른 커넥션에서 일어날 수 있어 "직렬화한다"는 약속이 응답 본문까지는
미치지 못하게 된다. `crud-actions.ts`의 `replace()` 안 주석이 이 차이를
"일관성 있게" 커밋 뒤로 옮기지 말라고 명시적으로 못박아 둔 것도 그래서다.

이 잠금이 실제로 이 계약을 지키는 힘의 근원인지는 별개 질문이다 — 이 저장소는
그 질문을 테스트로 직접 확인한 적이 있고, 답은 `test/AGENTS.md`의 동시성 테스트
절이 다룬다.

## `presentKeys`가 존재하는 이유 — 되돌림 사다리가 통째로 도달 불가능했던 사고

class-validator에는 Pydantic의 `MISSING` sentinel이 없다. "필드를 안 보냈다"와
"필드를 `null`로 보냈다"를 가르는 유일한 근거는 `document-parsing.ts`가 소유한
`presentKeys`다 — `src/app/jsonapi/document.ts`의 `parseResourceInput`이
`plainToInstance`로 검증 인스턴스를 만들기 **전**, 원본 `data.attributes`의 키
집합을 그대로 떠 둔 것이다. 이 키 집합은 검증된 객체에서 다시 뽑을 수 없다 —
뽑으면 안 된다.

이유는 `tsconfig.json`의 `target: ES2023`이 켜는 `useDefineForClassFields`다.
초기값 없는 선택 필드도 `plainToInstance`가 만든 인스턴스에는 own 프로퍼티로
**존재한다**(값은 `undefined`). 그래서 `key in attributes`나
`Object.keys(instance)` 같은 판정은 스키마가 소유한 프로퍼티 전부에 대해 언제나
참이 되어 "보냈는가"를 절대 구분하지 못한다 — `applyAttributes`(이 디렉터리)와
`replacementValues`(`upsert-executor.ts`)가 둘 다 `presentKeys.has(key)`로만
판정하는 이유다.

이 저장소는 실제로 이 우회를 겪었다. `replacementValues`가 이 판정을
`presentKeys` 대신 인스턴스의 own 프로퍼티 존재로 했을 때, 보내지 않은 필드를
기본값으로 되돌리는 사다리(`resetValueFor`)가 실제 요청 경로에서 통째로 도달
불가능해졌다 — 모든 프로퍼티가 "보냈다"로 보였기 때문이다. 단위 테스트는 이것을
잡지 못했다. 옛 테스트가 `attributes`로 순수 객체 리터럴을 넘겼는데, 리터럴은
안 쓴 키를 아예 갖지 않아 우연히 같은 답을 냈기 때문이다(이 함정의 일반형은
`test/AGENTS.md`의 "테스트가 초록인 이유" 절 참고, 근거는
`docs/superpowers/rulings/2026-08-30-phase5-rulings.md`). 새 코드가
`attributes`에서 "보냈는가"를 판정해야 한다면 `presentKeys` 말고는 옳은 근거가
없다.

## 함께 고쳐야 하는 파일

- **관계를 쓰기로 열거나 닫을 때.** 관계 이름을 `relationshipsSchema`에 넣으면
  `route-registrar.ts`가 `updateRelationship$<name>`(cardinality가 `many`면
  add/remove까지)을 만들고 `writeGuards`가 닿는 대상이 된다. 시리얼라이저 선언에만
  두고 `relationshipsSchema`에는 넣지 않으면 읽기 두 라우트만 생기고 영원히
  공개로 남는다. 엔티티·쓰기 스키마·시리얼라이저 세 곳의 cardinality를 맞추는
  것은 `src/app/AGENTS.md`가 다루므로 반복하지 않는다 — 다만 그 셋이 어긋나면
  `CrudActions`가 컨트롤러 모듈을 **import하는 순간**(요청이 들어와야 드러나는
  게 아니라 애플리케이션을 띄우기도 전에) `TypeError`로 죽는다는 것은 이
  디렉터리의 계약이다.
- **`enableUpsert`를 켤 때.** `replaceSchema`를 같은 선언에 함께 둔다 — 안 하면
  같은 이유로 import 시점에 죽는다. `route-registrar.ts`는 `enableUpsert`가
  없으면 `replace` 라우트 자체를 만들지 않으므로, 켜지 않은 자원의 `PUT`은
  404이지 405가 아니다.
- **`beforeSave` 훅에 같은 트랜잭션의 형제 행을 세는 로직을 넣을 때.** `replace`는
  `upsertRow`가 이미 행을 만들거나 갱신한 **뒤**에 이 훅이 돈다 — `create`는
  반대로 행이 아직 없을 때 돈다(`crud-base.ts`의 `CrudHooks.beforeSave` 문서
  참고). 같은 트랜잭션에서 개수를 세는 훅은 `PUT`에서만 자기 자신을 한 개 더
  센다. 코드로 맞추면 스펙 7.2("생성/교체 판정은 `ON CONFLICT` 문장이 한다")와
  충돌하므로, 이 차이는 지우는 대신 훅을 쓰는 쪽이 알고 있어야 한다.
- **저장·삭제의 트랜잭션 경계에 관한 계약을 바꿀 때.** `test/controllers/`의
  단위 테스트는 조립 시점 검사만 보고 실제 트랜잭션을 열지 않는다 — 롤백이
  실제로 일어나는지는 `test/integration/crud-transaction.spec.ts`처럼 진짜
  PostgreSQL로 증명해야 한다. 저장 **전**에 실패하는 경로(관계 대상을 못 찾는
  경우 등)는 트랜잭션 래퍼를 통째로 지워도 통과하므로, 그 경로만으로는 아무것도
  증명되지 않는다 — 저장 **후**에 실패하는 프로브가 있어야 무엇을 증명하는지
  스스로 안다.
