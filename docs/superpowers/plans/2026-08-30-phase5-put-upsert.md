# Phase 5: `PUT` upsert와 동시성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `enableUpsert`를 켠 자원에 `PUT /{id}`를 열어, 같은 ID로 동시에 들어온 요청이 서로를 덮어쓰지 않으면서 "없으면 만들고 있으면 통째로 교체"하게 한다.

**Architecture:** 한 트랜잭션 안에서 `pg_advisory_xact_lock(hashtext(id))`으로 같은 ID를 직렬화하고, `INSERT ... ON CONFLICT (id) DO UPDATE`로 생성과 교체를 한 문장에 담는다. 생성인지 교체인지는 `RETURNING (xmax = 0)`으로 같은 문장에서 알아낸다 — 사전 조회로 판정하지 않는다. 응답용 재조회도 **같은 트랜잭션 안**에서 한다.

**Tech Stack:** TypeScript 6.0.3(ESM, `strict` + `noUncheckedIndexedAccess`), NestJS 12, TypeORM 1.1.0, class-validator 0.15, PostgreSQL 18, Jest 30

**Spec:** `docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md` (7.2 PUT replace/upsert, 6.2 concern 분할의 `upsert-executor.ts`, 5.3 응답, 15 회귀 작성 규칙, 16 공개 API 표면)

## 사전 검증 결과 (계획 작성 중 실측)

이 단계의 설계가 서 있는 네 가지를 폐기용 프로브로 실제 PostgreSQL에 걸어 확인했다.

1. `INSERT ... ON CONFLICT (id) DO UPDATE ... RETURNING (xmax = 0) AS inserted`가 생성과 교체를 정확히 가른다. 첫 실행 `inserted=true`, 두 번째 `inserted=false`, 값은 갱신됨.
2. TypeORM의 `insert().orUpdate(['title'], ['id']).returning('(xmax = 0) AS inserted')`가 그 식을 실어 보내고 `result.raw`가 `[{"inserted":true}]` / `[{"inserted":false}]`로 온다.
3. `pg_advisory_xact_lock`은 트랜잭션이 끝나면 자동으로 풀린다(롤백 뒤 `pg_locks`의 advisory 잠금 0개).
4. `getMetadataStorage().getTargetValidationMetadatas(Schema, '', true, false)`로 쓰기 스키마의 필드 이름을 런타임에 읽을 수 있다(`ExampleReplace` → `body`·`publishedAt`·`status`·`title`).

4번이 필요한 이유: `PUT`은 **전체 교체**이므로 스키마가 소유한 필드 중 요청이 보내지 않은 것을 기본값으로 되돌려야 한다. 되돌릴 대상을 알려면 스키마의 필드 목록이 런타임에 있어야 한다.

## Phase 4가 남긴 발견 (이 계획이 닫는다)

Phase 4의 최종 리뷰가 짚었다: `create`/`update`는 응답용 재조회를 **커밋 뒤 트랜잭션 밖에서** 한다. 지금은 무해하다(READ COMMITTED에서 자기 쓰기를 본다). 그러나 `pg_advisory_xact_lock`은 **트랜잭션 스코프**라, upsert가 같은 방식을 쓰면 응답용 재조회가 잠금 밖에서 도는 별도 커넥션이 된다 — "동일 ID 동시 요청을 직렬화한다"는 약속에 응답 본문이 포함되지 않는다. `replace`는 재조회를 트랜잭션 **안**에서 한다.

## Global Constraints

- 모든 상대 import에 `.js` 확장자를 붙인다. 빠뜨리면 `tsc`가 `TS2835`로 거부한다.
- `noUncheckedIndexedAccess`가 켜져 있다. `!`나 `as`로 지우지 말고 실제 분기로 좁힌다.
- ESLint는 `strictTypeChecked` + `stylisticTypeChecked`다. `any`가 흘러나오는 표현은 전부 오류다.
- 함수 선언에는 명시적 반환 타입을 붙인다. 변수에 대입하는 화살표 함수도 필요하다.
- 오류는 `JsonApiError`(사용자 입력)와 `TypeError`(프로그래밍·선언 오류)만 던진다. 코드는 24개 카탈로그에서 고른다.
- **사전 조회로 생성/교체를 판정하지 않는다**(스펙 7.2). 판정은 `ON CONFLICT` 문장 자신이 한다.
- SQLite 대체 경로를 넣지 않는다.
- 주석과 테스트 이름은 한국어로 쓰고 **왜**를 적는다.
- 커밋 메시지에 AI 첨부 트레일러를 넣지 않는다.
- 모든 단계가 끝나면 `./scripts/check.sh`가 통과해야 한다.

---

## 이 계획이 만드는 파일

| 경로 | 책임 |
| --- | --- |
| `src/app/schemas/write-schema.ts` (수정) | `schemaProperties` — 쓰기 스키마의 필드 목록을 런타임에 읽는다 |
| `src/app/controllers/concerns/upsert-executor.ts` | advisory lock + `ON CONFLICT` 실행과 생성/교체 판정 |
| `src/app/controllers/concerns/crud-actions.ts` (수정) | `replace` 액션 |
| `src/app/controllers/concerns/route-registrar.ts` (수정) | `enableUpsert`일 때만 `PUT :id` 등록 |
| `src/app/controllers/api/v1/examples.controller.ts` (수정) | `enableUpsert: true`, `replaceSchema: ExampleReplace` |
| `test/integration/upsert-executor.spec.ts` | 실행기의 계약 |
| `test/integration/examples-put.spec.ts` | `PUT`의 wire 계약과 동시성 |

---

### Task 1: 쓰기 스키마의 필드 목록을 런타임에 읽기

**Files:**
- Modify: `src/app/schemas/write-schema.ts`
- Modify: `src/app/schemas/index.ts` (재export)
- Test: `test/schemas/write-schema.spec.ts`

**Interfaces:**
- Produces: `function schemaProperties(schema: ClassConstructor<object>): readonly string[]`

**왜 필요한가:** `PUT`은 전체 교체다. 요청이 보내지 않은 필드는 기본값으로 돌아가야 하는데, 되돌릴 대상을 알려면 "이 스키마가 소유한 필드"가 무엇인지 런타임에 알아야 한다. TypeScript의 선언 필드는 초기값이 없으면 인스턴스에 존재하지 않으므로 `Object.keys`로는 잡히지 않는다. class-validator가 데코레이터를 등록해 둔 메타데이터가 유일하게 정확한 출처다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/schemas/write-schema.spec.ts`에 더한다(파일 위쪽 import에 `schemaProperties` 추가).

```ts
describe('schemaProperties', () => {
  it('데코레이터가 붙은 필드 이름을 모두 돌려준다', () => {
    expect([...schemaProperties(Sample)].sort()).toEqual(['size', 'title']);
  });

  it('같은 필드에 데코레이터가 여러 개여도 한 번만 센다', () => {
    // `Sample.title`에는 `@IsString()`과 `@Length()`가 붙어 있다.
    expect(schemaProperties(Sample).filter((name) => name === 'title')).toHaveLength(1);
  });

  it('중첩 스키마의 자식 필드는 부모 목록에 넣지 않는다', () => {
    // `Parent`가 소유하는 것은 `title`과 `child`이지 `child.name`이 아니다.
    // 자식의 기본값은 자식 스키마가 정할 일이다.
    expect([...schemaProperties(Parent)].sort()).toEqual(['child', 'title']);
  });

  it('데코레이터가 없는 클래스는 빈 목록이다', () => {
    class Bare {}
    expect(schemaProperties(Bare)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/schemas`
Expected: FAIL — `schemaProperties is not exported`

- [ ] **Step 3: 구현한다**

`src/app/schemas/write-schema.ts`에 더한다. 파일 위쪽 import에 `getMetadataStorage`를 추가한다.

```ts
import { getMetadataStorage, validate } from 'class-validator';
```

그리고 파일 끝에 더한다.

```ts
/**
 * 쓰기 스키마가 소유한 필드 이름.
 *
 * `PUT`의 전체 교체가 이 목록을 쓴다 — 요청이 보내지 않은 필드를 기본값으로 되돌리려면
 * 되돌릴 대상을 알아야 한다. TypeScript의 선언 필드는 초기값이 없으면 인스턴스에
 * 존재하지 않아 `Object.keys`로 잡히지 않으므로, 데코레이터가 등록해 둔
 * class-validator 메타데이터가 유일하게 정확한 출처다.
 *
 * 상속 체인까지 훑는다(세 번째 인자 `true`). 스키마를 상속으로 나눠 쓰는 것은 흔한
 * 정리 방식이고, 부모의 필드를 빠뜨리면 그 필드가 교체 대상에서 조용히 빠진다.
 */
export function schemaProperties(schema: ClassConstructor<object>): readonly string[] {
  const metadatas = getMetadataStorage().getTargetValidationMetadatas(schema, '', true, false);
  return [...new Set(metadatas.map((metadata) => metadata.propertyName))];
}
```

`src/app/schemas/index.ts`의 `write-schema.js` 재export 줄에 `schemaProperties`를 더한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/schemas`
Expected: PASS

- [ ] **Step 5: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`

- [ ] **Step 6: 커밋한다**

```bash
git add src/app/schemas test/schemas/write-schema.spec.ts
git commit -m "feat(schemas): 쓰기 스키마의 필드 목록을 런타임에 읽는 헬퍼 추가"
```

---
### Task 2: upsert 실행기

**Files:**
- Create: `src/app/controllers/concerns/upsert-executor.ts`
- Test: `test/integration/upsert-executor.spec.ts`

**Interfaces:**
- Consumes: `schemaProperties` (Task 1)
- Produces:
  - `interface UpsertOutcome { created: boolean }`
  - `function replacementValues<T extends ObjectLiteral>(manager: EntityManager, model: EntityTarget<T>, attributes: object, ownedProperties: readonly string[]): Record<string, unknown>`
  - `function upsertRow<T extends ObjectLiteral & { id: string }>(manager: EntityManager, model: EntityTarget<T>, id: string, values: Readonly<Record<string, unknown>>): Promise<UpsertOutcome>`

**설계 — 왜 이 모양인가:**

실행기는 두 가지만 한다. **id를 원자적으로 차지하고, 그것이 생성이었는지 교체였는지 알려 준다.** 나머지(관계 조인 행, 훅, `@UpdateDateColumn`)는 호출자가 같은 트랜잭션 안에서 이미 검증된 `save()` 경로로 처리한다. 실행기가 전부 하려 들면 Phase 4가 테스트해 둔 경로를 우회하는 두 번째 저장 경로가 생긴다.

- `pg_advisory_xact_lock(hashtext(id))`은 **트랜잭션 스코프**다. 호출자의 트랜잭션이 끝나면 자동으로 풀리고, 풀어 주는 코드를 잊을 자리가 없다.
- 생성/교체 판정은 `RETURNING (xmax = 0)`이 한다. 사전 조회로 판정하지 않는다(스펙 7.2) — 잠금 아래에서는 사전 조회도 안전하지만, 판정을 문장 밖으로 빼면 그 문장이 원자적이라는 사실이 설계에서 사라진다.
- `orUpdate`는 **DB 컬럼 이름**을 받는다(프로퍼티 이름이 아니다). `values`는 반대로 프로퍼티 이름을 받는다. 둘을 섞으면 조용히 아무것도 갱신하지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/integration/upsert-executor.spec.ts`:

```ts
import type { DataSource } from 'typeorm';
import {
  replacementValues,
  upsertRow,
} from '../../src/app/controllers/concerns/upsert-executor.js';
import { Example } from '../../src/app/models/example.entity.js';
import { ExampleReplace } from '../../src/app/schemas/example.schemas.js';
import { schemaProperties } from '../../src/app/schemas/write-schema.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

const ID = '0195c1a0-0000-7000-8000-00000000e001';
const OWNED = schemaProperties(ExampleReplace);

describe('replacementValues', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('보낸 필드는 그대로 싣는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect(values.title).toBe('제목');
    });
  });

  it('보내지 않은 nullable 필드를 null로 되돌린다', async () => {
    // PUT은 전체 교체다. 보내지 않은 필드가 예전 값을 유지하면 PATCH와 구분이 없어진다.
    await withRollback(dataSource, async (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect(values.body).toBeNull();
      expect(values.publishedAt).toBeNull();
    });
  });

  it('보내지 않은 필드에 컬럼 기본값이 있으면 그 값으로 되돌린다', async () => {
    await withRollback(dataSource, async (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect(values.status).toBe('draft');
    });
  });

  it('null로 보낸 nullable 필드도 null이다', async () => {
    await withRollback(dataSource, async (manager) => {
      const values = replacementValues(manager, Example, { title: '제목', body: null }, OWNED);
      expect(values.body).toBeNull();
    });
  });

  it('스키마에 없는 프로퍼티는 싣지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect('categoryId' in values).toBe(false);
      expect('createdAt' in values).toBe(false);
    });
  });

  it('컬럼이 없는 프로퍼티를 요구하면 프로그래밍 오류다', async () => {
    await withRollback(dataSource, async (manager) => {
      expect(() => replacementValues(manager, Example, {}, ['없는필드'])).toThrow(TypeError);
    });
  });

  it('되돌릴 값이 없는 필드를 요구하면 프로그래밍 오류다', async () => {
    // `title`은 NOT NULL이고 기본값도 없다. 교체 스키마가 이 필드를 선택으로 두면
    // 되돌릴 값이 없으므로, 그 선언 실수를 여기서 시끄럽게 잡는다.
    await withRollback(dataSource, async (manager) => {
      expect(() => replacementValues(manager, Example, {}, ['title'])).toThrow(/title/);
    });
  });
});

describe('upsertRow', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('없는 id면 만들고 created를 참으로 낸다', async () => {
    await withRollback(dataSource, async (manager) => {
      const outcome = await upsertRow(manager, Example, ID, { title: '처음' });
      expect(outcome.created).toBe(true);

      const rows = await manager.query<{ title: string }[]>(
        `SELECT title FROM examples WHERE id = $1`,
        [ID],
      );
      expect(rows).toEqual([{ title: '처음' }]);
    });
  });

  it('있는 id면 교체하고 created를 거짓으로 낸다', async () => {
    await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음' });
      const outcome = await upsertRow(manager, Example, ID, { title: '두 번째' });
      expect(outcome.created).toBe(false);

      const rows = await manager.query<{ title: string }[]>(
        `SELECT title FROM examples WHERE id = $1`,
        [ID],
      );
      expect(rows).toEqual([{ title: '두 번째' }]);
    });
  });

  it('행이 하나만 남는다', async () => {
    // `ON CONFLICT`가 아니라 그냥 INSERT였다면 두 번째가 유일성 위반으로 죽거나
    // 행이 둘이 된다.
    await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음' });
      await upsertRow(manager, Example, ID, { title: '두 번째' });
      const rows = await manager.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
        [ID],
      );
      expect(rows).toEqual([{ count: 1 }]);
    });
  });

  it('보낸 컬럼만 갱신한다', async () => {
    await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음', body: '본문' });
      await upsertRow(manager, Example, ID, { title: '두 번째' });
      const rows = await manager.query<{ body: string | null }[]>(
        `SELECT body FROM examples WHERE id = $1`,
        [ID],
      );
      // 두 번째 호출이 `body`를 싣지 않았으므로 예전 값이 남는다. 전체 교체 의미는
      // 호출자가 `replacementValues`로 되돌릴 값을 채워 넣는 것으로 만든다.
      expect(rows).toEqual([{ body: '본문' }]);
    });
  });

  it('트랜잭션 안에서 advisory 잠금을 잡는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음' });
      const locks = await manager.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype = 'advisory'`,
      );
      expect(locks[0]?.count).toBeGreaterThan(0);
    });
  });

  it('트랜잭션이 끝나면 잠금이 풀린다', async () => {
    // `pg_advisory_xact_lock`은 트랜잭션 스코프다. 풀어 주는 코드를 잊을 자리가 없다는
    // 것이 세션 스코프 잠금 대신 이것을 고른 이유다.
    await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음' });
    });
    const locks = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype = 'advisory'`,
    );
    expect(locks[0]?.count).toBe(0);
  });

  it('값이 비면 프로그래밍 오류다', async () => {
    // 갱신할 컬럼이 하나도 없으면 `ON CONFLICT DO UPDATE`가 만들 SET 절이 없다.
    await withRollback(dataSource, async (manager) => {
      await expect(upsertRow(manager, Example, ID, {})).rejects.toThrow(TypeError);
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `./scripts/check.sh` (또는 `TEST_DATABASE_URL`을 세팅한 뒤 이 스펙만)
Expected: FAIL — `Cannot find module '../../src/app/controllers/concerns/upsert-executor.js'`

- [ ] **Step 3: 구현한다**

`src/app/controllers/concerns/upsert-executor.ts`:

```ts
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/**
 * `PUT` upsert의 원자적 부분.
 *
 * 이 파일은 두 가지만 한다 — **id를 원자적으로 차지하고, 그것이 생성이었는지 교체였는지
 * 알려 준다.** 관계 조인 행·훅·`@UpdateDateColumn`은 호출자가 같은 트랜잭션 안에서 이미
 * 검증된 `save()` 경로로 처리한다. 여기서 전부 하려 들면 Phase 4가 테스트해 둔 경로를
 * 우회하는 두 번째 저장 경로가 생긴다.
 *
 * 잠금은 `pg_advisory_xact_lock`이다. **트랜잭션 스코프**라 호출자의 트랜잭션이 끝나면
 * 자동으로 풀린다 — 풀어 주는 코드를 잊을 자리가 없다. 세션 스코프 잠금을 쓰면 커넥션이
 * 풀에 돌아간 뒤에도 잠금이 남아, 다음에 그 커넥션을 받은 요청이 이유 없이 막힌다.
 *
 * 생성/교체 판정은 `RETURNING (xmax = 0)`이 한다. PostgreSQL은 방금 삽입한 튜플의
 * `xmax`를 0으로 두고, `ON CONFLICT DO UPDATE`가 갱신한 튜플에는 갱신 트랜잭션의 id를
 * 넣는다. 사전 조회로 판정하지 않는 이유는 스펙 7.2의 요구이기도 하고, 판정을 문장
 * 밖으로 빼면 그 문장이 원자적이라는 사실이 설계에서 사라지기 때문이기도 하다.
 */

/** upsert 결과. */
export interface UpsertOutcome {
  /** 이번 요청이 행을 만들었는가. `false`면 교체했다는 뜻이다. */
  readonly created: boolean;
}

/**
 * 보내지 않은 필드를 무엇으로 되돌릴지 정한다.
 *
 * 컬럼 기본값이 있으면 그 값, 없고 nullable이면 `null`이다. 둘 다 아니면 되돌릴 값이
 * 없다는 뜻이고, 그것은 교체 스키마가 그 필드를 필수로 선언했어야 한다는 선언 실수다.
 */
function resetValueFor(column: ColumnMetadata): unknown {
  if (column.default !== undefined) {
    return column.default;
  }
  if (column.isNullable) {
    return null;
  }
  throw new TypeError(
    `"${column.propertyName}"은(는) NOT NULL이고 컬럼 기본값도 없어 되돌릴 값이 없다. 교체 스키마에서 필수 필드로 선언해야 한다`,
  );
}

/**
 * 전체 교체가 쓸 값 묶음을 만든다.
 *
 * 스키마가 소유한 필드 전부를 담되, 요청이 보내지 않은 것은 기본값으로 되돌린다.
 * 이것이 `PUT`과 `PATCH`가 갈리는 지점이다 — `PATCH`는 보낸 것만 옮기고, `PUT`은
 * 보내지 않은 것까지 되돌린다.
 */
export function replacementValues<T extends ObjectLiteral>(
  manager: EntityManager,
  model: EntityTarget<T>,
  attributes: object,
  ownedProperties: readonly string[],
): Record<string, unknown> {
  const metadata = manager.dataSource.getMetadata(model);
  const values: Record<string, unknown> = {};

  for (const property of ownedProperties) {
    const column = metadata.findColumnWithPropertyName(property);
    if (column === undefined) {
      throw new TypeError(`교체 스키마의 "${property}"에 대응하는 컬럼이 없다`);
    }
    if (property in attributes) {
      const value: unknown = Reflect.get(attributes, property);
      values[property] = value;
      continue;
    }
    values[property] = resetValueFor(column);
  }

  return values;
}

/**
 * 같은 id를 직렬화한 채로 행을 만들거나 교체한다. 호출자가 트랜잭션을 소유한다.
 *
 * `values`의 키는 **프로퍼티 이름**이고 `orUpdate`에 넘기는 것은 **DB 컬럼 이름**이다.
 * 둘을 섞으면 갱신 절이 비어 조용히 아무것도 바뀌지 않는다.
 */
export async function upsertRow<T extends ObjectLiteral & { id: string }>(
  manager: EntityManager,
  model: EntityTarget<T>,
  id: string,
  values: Readonly<Record<string, unknown>>,
): Promise<UpsertOutcome> {
  const properties = Object.keys(values);
  if (properties.length === 0) {
    throw new TypeError('upsert에 갱신할 값이 하나도 없다');
  }

  const metadata = manager.dataSource.getMetadata(model);
  const updatable = properties.map((property) => {
    const column = metadata.findColumnWithPropertyName(property);
    if (column === undefined) {
      throw new TypeError(`"${property}"에 대응하는 컬럼이 없다`);
    }
    return column.databaseName;
  });

  // 같은 id에 대한 요청을 이 트랜잭션이 끝날 때까지 직렬화한다. `hashtext`는 임의
  // 문자열을 advisory 잠금이 받는 정수로 접는다 — 충돌하면 서로 다른 id가 같은 잠금을
  // 나눠 갖게 되지만, 그 결과는 불필요한 대기일 뿐 정확성을 해치지 않는다.
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);

  const result = await manager
    .createQueryBuilder()
    .insert()
    .into(model)
    .values({ ...values, id })
    .orUpdate(updatable, ['id'])
    .returning('(xmax = 0) AS inserted')
    .execute();

  const raw: unknown = result.raw;
  if (!Array.isArray(raw)) {
    throw new TypeError('upsert가 RETURNING 결과를 돌려주지 않았다');
  }
  const [row] = raw as unknown[];
  if (typeof row !== 'object' || row === null || !('inserted' in row)) {
    throw new TypeError('upsert의 RETURNING 결과에 inserted가 없다');
  }
  const inserted: unknown = Reflect.get(row, 'inserted');
  if (typeof inserted !== 'boolean') {
    throw new TypeError('upsert의 inserted가 참거짓이 아니다');
  }

  return { created: inserted };
}
```

**타입에서 막히기 쉬운 곳:**
- `const [row] = raw as unknown[]`는 캐스트다. `Array.isArray`가 이미 `raw`를 좁혔으므로 `const rows: unknown[] = raw;`로 받아 인덱싱하면 캐스트 없이 된다. 그렇게 고쳐 쓰라.
- `ColumnMetadata`의 import 경로가 `typeorm`의 공개 표면에 없으면 `import type { ColumnMetadata } from 'typeorm'`을 먼저 시도하고, 안 되면 `resetValueFor`의 인자 타입을 `{ default?: unknown; isNullable: boolean; propertyName: string }` 구조 타입으로 좁혀 선언하라 — 이 함수가 쓰는 것은 그 세 멤버뿐이다.
- `.into(model)`이 `EntityTarget<T>`를 받지 않으면 `.into(metadata.target)`을 쓰라.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `./scripts/check.sh`
Expected: exit 0

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/controllers/concerns/upsert-executor.ts test/integration/upsert-executor.spec.ts
git commit -m "feat(controllers): advisory 잠금과 ON CONFLICT 기반 upsert 실행기 추가"
```

---
### Task 3: `replace` 액션과 `PUT` 라우트

**Files:**
- Modify: `src/app/controllers/concerns/route-registrar.ts`
- Modify: `src/app/controllers/concerns/crud-actions.ts`
- Modify: `src/app/controllers/api/v1/examples.controller.ts`
- Modify: `test/controllers/route-registrar.spec.ts`, `test/config/routes.module.spec.ts`, `test/config/openapi.spec.ts`

**Interfaces:**
- Consumes: `replacementValues`, `upsertRow` (Task 2); `schemaProperties` (Task 1)
- Produces: `CrudActionsHost.replace(id, body, response)`; `PUT :id` 라우트

**사전 검증 결과 (계획 작성 중 실측):** `@Res({ passthrough: true })`를 받은 핸들러가 `res.status(201)`을 부르면 **Nest가 덮어쓰지 않는다.** `PUT`의 기본 200과 `@HttpCode(200)`을 명시한 경우 모두에서 확인했다. 그래서 한 핸들러가 생성 201과 교체 200을 동적으로 낼 수 있다.

**설계 — 왜 upsert 문장이 attribute만 싣는가:**

관계는 `save()`가 처리한다. to-one은 FK 컬럼이라 upsert 문장에 실을 수도 있지만, to-many 조인 행은 어차피 문장 하나로 안 된다. 둘을 갈라 두면 저장 경로가 두 벌이 되므로, upsert 문장은 **id를 차지하고 attribute를 교체**하는 데까지만 쓰고 관계는 Phase 4가 이미 테스트해 둔 `save()` 경로로 보낸다. 같은 트랜잭션·같은 잠금 안이라 원자성은 그대로다.

**재조회를 트랜잭션 안에서 하는 이유:** `pg_advisory_xact_lock`은 트랜잭션 스코프다. `create`/`update`처럼 커밋 뒤에 읽으면 그 읽기는 잠금 밖의 별도 커넥션이 되고, "동일 ID 동시 요청을 직렬화한다"는 약속에 응답 본문이 포함되지 않는다.

- [ ] **Step 1: 라우트 등록기에 `PUT`을 더한다**

`src/app/controllers/concerns/route-registrar.ts`의 import에 `Put`을 더하고, `destroy` 등록 다음에 아래를 넣는다.

```ts
  // `PUT`은 선언이 켠 자원에만 생긴다. 켜지 않은 자원에서 `PUT`을 부르면 라우트가 없어
  // 404가 나가고, 그것이 "이 자원은 upsert를 지원하지 않는다"의 정확한 답이다.
  if (declaration.enableUpsert === true) {
    decorate(proto, 'replace', (descriptor) => {
      Put(':id')(proto, 'replace', descriptor);
      Param('id')(proto, 'replace', 0);
      Body()(proto, 'replace', 1);
      // 생성이면 `Location`을 붙이고 201로 바꾼다. 교체는 기본값 200 그대로다.
      Res({ passthrough: true })(proto, 'replace', 2);
    });
    writeMethods.push('replace');
  }
```

- [ ] **Step 2: `replace` 액션을 만든다**

`src/app/controllers/concerns/crud-actions.ts`의 import에 더한다.

```ts
import { schemaProperties } from '../../schemas/write-schema.js';
import { replacementValues, upsertRow } from './upsert-executor.js';
```

`destroy` 다음에 액션을 더한다.

```ts
    /**
     * 자원을 통째로 교체하거나 만든다.
     *
     * 스펙 7.2: 같은 ID로 동시에 들어온 요청은 advisory 트랜잭션 잠금으로 직렬화되고,
     * 생성/교체 판정은 `INSERT ... ON CONFLICT`가 같은 문장에서 한다. 생성은 201 +
     * `Location`, 교체는 200이다.
     */
    async replace(
      id: string,
      body: unknown,
      response: HeaderWritableResponse & { status(code: number): unknown },
    ): Promise<SingleDocument> {
      const schema = declaration.replaceSchema;
      if (schema === undefined) {
        throw new TypeError('replaceSchema 없이 replace가 호출됐다');
      }

      const parsed = await parseWriteDocument(body, schema, {
        expectedType: serializer.type,
        expectedId: id,
        // `PUT`은 클라이언트가 고른 id로 만드는 것이 정상 경로다. `POST`와 달리
        // 서버가 id를 만들지 않는다.
        allowClientGeneratedId: true,
      });

      const outcome = await this.dataSource.transaction(async (manager) => {
        this.assertIdShape(manager, id);

        const values = replacementValues(manager, model, parsed.attributes, schemaProperties(schema));
        const { created } = await upsertRow(manager, model, id, values);

        const entity = await this.findOne(manager, id, []);
        const linkage = await resolveRelationships(manager, relationshipsSchema, parsed.relationships);

        // 전체 교체이므로 보내지 않은 관계는 비운다. `PATCH`가 건드리지 않는 것과
        // 갈리는 지점이고, 스펙 15장이 "관계 reset"을 회귀 대상으로 지목한 곳이다.
        for (const [name, rule] of Object.entries(relationshipsSchema)) {
          if (name in linkage.toOne || name in linkage.toMany) {
            continue;
          }
          Reflect.set(entity, name, rule.cardinality === 'many' ? [] : null);
        }
        this.applyLinkage(entity, linkage);

        await declaration.beforeSave?.(entity, manager);
        const stored = await manager.getRepository(model).save(entity);
        await declaration.afterSave?.(stored, manager);

        // 재조회도 트랜잭션 안에서 한다. advisory 잠금이 트랜잭션 스코프라, 밖에서
        // 읽으면 그 읽기는 직렬화 범위 밖이 된다.
        const reloaded = await this.findOne(manager, id, Object.keys(parsed.relationships));
        return {
          created,
          document: singleDocument(serializeResource(serializer, reloaded), []),
        };
      });

      if (outcome.created) {
        response.setHeader('Location', `${this.basePath}/${id}`);
        response.status(201);
      }
      return outcome.document;
    }
```

`ParseResourceOptions`에 `allowClientGeneratedId`가 있는지 확인하라. `expectedId`가 주어지면 `parseResourceInput`이 이미 id 일치만 보고 클라이언트 생성 id를 거부하지 않으므로, 그 경우 `allowClientGeneratedId`는 필요 없다 — 코드를 읽고 필요 없으면 그 줄을 빼라.

- [ ] **Step 3: 컨트롤러에 upsert를 켠다**

`src/app/controllers/api/v1/examples.controller.ts`의 선언에 두 줄을 더하고 import에 `ExampleReplace`를 넣는다.

```ts
  replaceSchema: ExampleReplace,
  enableUpsert: true,
```

- [ ] **Step 4: 라우트 계약 테스트를 넓힌다**

`test/controllers/route-registrar.spec.ts`에서 `enableUpsert`를 켠 프로브를 하나 더 만들고, 아래를 확인한다.

```ts
  it('enableUpsert를 켜면 PUT이 생긴다', () => {
    // 켜지 않은 기존 프로브에는 없다는 단언이 이미 있다. 두 방향을 함께 고정한다.
    expect(upsertRoutes).toContain('PUT /api/v1/examples/:id');
  });
```

`test/config/routes.module.spec.ts`의 기대 목록에 `'PUT /api/v1/examples/:id'`를 알파벳 순서에 맞게 더한다(`'POST /api/v1/examples/:id/relationships/tags'` 다음).

`test/config/openapi.spec.ts`의 경로 목록도 함께 갱신한다(OpenAPI는 `{id}` 표기).

- [ ] **Step 5: 전체 게이트를 돌린다**

Run: `./scripts/check.sh`
Expected: exit 0

- [ ] **Step 6: 커밋한다**

```bash
git add src/app/controllers src/config test/controllers test/config
git commit -m "feat(controllers): PUT 전체 교체와 upsert 라우트 추가"
```

---

### Task 4: `PUT`의 wire 계약과 동시성

**Files:**
- Create: `test/integration/examples-put.spec.ts`

**계약 (스펙 15장이 지목한 회귀):** 201+`Location`, 200 교체, 동일 ID 동시 요청, 관계 reset, 훅 실패 롤백.

**정리 방식:** 이 스위트도 행을 커밋한다. `examples-api.spec.ts`와 같은 이유로 `TRUNCATE`를 쓰지 않고, 이 스위트가 쓰는 고정 id만 `DELETE`로 지운다 — 조건 없는 삭제는 같은 순간 다른 워커가 커밋해 둔 행까지 지운다.

- [ ] **Step 1: 테스트를 쓴다**

`test/integration/examples-put.spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';

const VENDOR = 'application/vnd.api+json';
const ID = '0195c1a0-0000-7000-8000-00000000d001';
const OTHER = '0195c1a0-0000-7000-8000-00000000d002';

interface ResourceBody {
  data: {
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data?: unknown }>;
  };
}

describe('PUT /api/v1/examples/{id}', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;

  const api = () => request(app.getHttpServer());

  function put(id: string, attributes: Record<string, unknown>, relationships?: unknown) {
    return api()
      .put(`/api/v1/examples/${id}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            id,
            attributes,
            ...(relationships === undefined ? {} : { relationships }),
          },
        }),
      );
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterEach(async () => {
    // 이 스위트가 쓰는 id만 지운다. 조건 없는 삭제는 같은 순간 다른 워커가 커밋해 둔
    // 행까지 지운다.
    await dataSource.query('DELETE FROM example_tags WHERE example_id = ANY($1)', [[ID, OTHER]]);
    await dataSource.query('DELETE FROM examples WHERE id = ANY($1)', [[ID, OTHER]]);
    await dataSource.query(`DELETE FROM tags WHERE name LIKE 'put-%'`);
    await dataSource.query(`DELETE FROM categories WHERE name LIKE 'put-%'`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('없는 id면 201과 Location을 낸다', async () => {
    const response = await put(ID, { title: '만들어진 것' });

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/examples/${ID}`);
    expect(response.headers['content-type']).toBe(VENDOR);
    const body = response.body as ResourceBody;
    expect(body.data.id).toBe(ID);
    expect(body.data.attributes.title).toBe('만들어진 것');
    // 보내지 않은 필드는 컬럼 기본값으로 들어간다.
    expect(body.data.attributes.status).toBe('draft');
  });

  it('있는 id면 200으로 교체한다', async () => {
    await put(ID, { title: '처음' }).expect(201);
    const response = await put(ID, { title: '두 번째' });

    expect(response.status).toBe(200);
    // 교체는 생성이 아니므로 Location을 내지 않는다.
    expect(response.headers.location).toBeUndefined();
    expect((response.body as ResourceBody).data.attributes.title).toBe('두 번째');
  });

  it('행이 하나만 남는다', async () => {
    await put(ID, { title: '처음' }).expect(201);
    await put(ID, { title: '두 번째' }).expect(200);
    const rows = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
      [ID],
    );
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('보내지 않은 attribute를 기본값으로 되돌린다', async () => {
    // 이것이 PATCH와 갈리는 지점이다. PATCH였다면 body가 남는다.
    await put(ID, { title: '처음', body: '본문', status: 'published' }).expect(201);
    const response = await put(ID, { title: '두 번째' });

    const attributes = (response.body as ResourceBody).data.attributes;
    expect(attributes.body).toBeNull();
    expect(attributes.status).toBe('draft');
  });

  it('보내지 않은 관계를 비운다', async () => {
    const tags = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('put-ㄱ'), ('put-ㄴ') RETURNING id`,
    );
    const linkage = tags.map((tag) => ({ type: 'tags', id: tag.id }));

    await put(ID, { title: '처음' }, { tags: { data: linkage } }).expect(201);
    const before = await api().get(`/api/v1/examples/${ID}/relationships/tags`).set('Accept', VENDOR);
    expect((before.body as { data: unknown[] }).data).toHaveLength(2);

    await put(ID, { title: '두 번째' }).expect(200);
    const after = await api().get(`/api/v1/examples/${ID}/relationships/tags`).set('Accept', VENDOR);
    expect((after.body as { data: unknown[] }).data).toEqual([]);
  });

  it('to-one 관계도 비운다', async () => {
    const categories = await dataSource.query<{ id: string }[]>(
      `INSERT INTO categories (name) VALUES ('put-분류') RETURNING id`,
    );
    const categoryId = categories[0]?.id;
    if (categoryId === undefined) {
      throw new Error('분류를 만들지 못했다');
    }

    await put(ID, { title: '처음' }, { category: { data: { type: 'categories', id: categoryId } } })
      .expect(201);
    const response = await put(ID, { title: '두 번째' });
    expect((response.body as ResourceBody).data.relationships.category?.data).toBeNull();
  });

  it('경로와 문서의 id가 다르면 409다', async () => {
    const response = await api()
      .put(`/api/v1/examples/${ID}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({ data: { type: 'examples', id: OTHER, attributes: { title: '제목' } } }),
      );
    expect(response.status).toBe(409);
  });

  it('교체 스키마의 필수 필드가 없으면 422다', async () => {
    // PUT은 전체 교체라 생성과 같은 필수 조건을 건다.
    const response = await put(ID, {});
    expect(response.status).toBe(422);
  });

  it('없는 관계 대상을 가리키면 자원도 남지 않는다', async () => {
    const missing = '0195c1a0-0000-7000-8000-0000000009ff';
    await put(ID, { title: '제목' }, { category: { data: { type: 'categories', id: missing } } })
      .expect(404);

    const rows = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
      [ID],
    );
    // upsert 문장이 이미 행을 만든 뒤에 관계 해석이 실패한다. 트랜잭션이 그것을
    // 되돌리지 않으면 클라이언트가 만든 적 없는 자원이 남는다.
    expect(rows).toEqual([{ count: 0 }]);
  });

  it('같은 id로 동시에 들어온 두 요청이 섞이지 않는다', async () => {
    // 이 테스트가 advisory 잠금의 존재 이유다. 두 요청은 attribute와 관계를 모두
    // 다르게 보낸다. 직렬화되지 않으면 한쪽의 제목과 다른 쪽의 관계가 섞인 상태가
    // 남을 수 있다 — 두 요청 중 어느 것도 보낸 적 없는 상태다.
    const tags = await dataSource.query<{ id: string }[]>(
      `INSERT INTO tags (name) VALUES ('put-동시') RETURNING id`,
    );
    const tagId = tags[0]?.id;
    if (tagId === undefined) {
      throw new Error('라벨을 만들지 못했다');
    }

    const [first, second] = await Promise.all([
      put(ID, { title: '가' }, { tags: { data: [{ type: 'tags', id: tagId }] } }),
      put(ID, { title: '나' }, { tags: { data: [] } }),
    ]);

    // 둘 다 성공하고, 정확히 하나만 생성이다.
    expect([first.status, second.status].sort()).toEqual([200, 201]);

    const rows = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
      [ID],
    );
    expect(rows).toEqual([{ count: 1 }]);

    const final = await api().get(`/api/v1/examples/${ID}?include=tags`).set('Accept', VENDOR);
    const attributes = (final.body as ResourceBody).data.attributes;
    const linkage = (final.body as ResourceBody).data.relationships.tags?.data;

    // 최종 상태는 두 요청 중 **하나와 통째로** 같아야 한다. 어느 쪽이 이기는지는
    // 정하지 않는다 — 직렬화가 보장하는 것은 승자가 있다는 것이지 누구인지가 아니다.
    const wonByFirst = attributes.title === '가' && Array.isArray(linkage) && linkage.length === 1;
    const wonBySecond = attributes.title === '나' && Array.isArray(linkage) && linkage.length === 0;
    expect(wonByFirst || wonBySecond).toBe(true);
  });
});
```

- [ ] **Step 2: 전체 게이트를 돌린다**

Run: `./scripts/check.sh`
Expected: exit 0

동시성 테스트가 불안정하면 원인을 먼저 보라. 커넥션 풀이 2개 미만이면 두 요청이 커넥션을 못 얻어 서로를 기다린다 — `DB_POOL_MAX`의 기본값은 10이므로 정상 경로에서는 문제가 없다.

- [ ] **Step 3: 커밋한다**

```bash
git add test/integration/examples-put.spec.ts
git commit -m "test(integration): PUT의 생성·교체·reset·동시성을 실제 PostgreSQL로 고정"
```

---

## 마무리

- [ ] **README를 갱신한다**

- `## API 사용`에 `PUT` 예시를 더한다(다른 예시와 같은 헤더, 대괄호·중괄호가 있으므로 `-g`).
- 첫 문단과 `## 구조` 아래 문단의 `Phase 0-4`를 `Phase 0-5`로 바꾼다.
- 미구현 목록에서 "`PUT` upsert"를 뺀다. 남는 것은 인증, 비동기 작업, `AGENTS.md` 문서군이다.

- [ ] **커밋한다**

```bash
git add README.md
git commit -m "docs: Phase 5 진행 상태와 PUT 예시를 README에 반영"
```
