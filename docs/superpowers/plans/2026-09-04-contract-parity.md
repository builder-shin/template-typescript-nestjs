# NestJS 계약 통일 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이 저장소의 공개 계약을 정본(`template-python-fastapi`)과 같게 만들고, 세 백엔드에 공통으로 추가되는 `categories`·`tags` 읽기 라우트를 얹는다.

**Architecture:** Example 도메인이 정본에서 갈라진 지점을 되돌린다 — 자원 타입 이름, 리소스 스키마, 조회 정책, 기본 페이지 크기. 스키마 변경은 이미 적용된 마이그레이션을 고치지 않고 새 마이그레이션 하나로만 전달한다. 참조 자원은 `CrudActions`에 `enableWrites` 옵션을 더한 뒤 그 위에 선언만으로 올린다 — `enableUpsert`가 같은 모양의 선례다.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, class-validator, Jest, pnpm

**Spec:** `docs/superpowers/specs/2026-09-04-contract-parity-design.md`

## Global Constraints

- 완료 조건은 하나다 — **같은 요청에 정본과 같은 문서가 나온다.**
- JSON:API 자원 타입은 `exampleCategories` · `exampleTags`다. URL 경로(`/api/v1/categories` · `/api/v1/tags`)와 다른 것은 의도된 결정이다.
- 리소스 스키마 목표: `description` (text, nullable) · `score` (integer NOT NULL, `CHECK score >= 0 AND score <= 100`) · status `draft` / `active` / `archived`.
- 조회 정책 목표: filters `title`[exact, contains] · `status`[exact, in] · `score`[exact, gt, gte, lt, lte, in] · `category.id`[exact, in, isNull] · `createdAt`[exact, gt, gte, lt, lte] / sorts `title` · `status` · `score` · `createdAt` · `updatedAt` / `defaultSort` `createdAt DESC` / `tieBreaker` `id ASC` / `includes` `category` · `tags`.
- `id`는 tie breaker **전용**이다. 정본의 공개 정렬에 `id`가 없다.
- `defaultPageSize`는 **20**이다. `MAX_PAGE_SIZE`는 100으로 이미 세 저장소가 같다.
- **이미 적용된 마이그레이션을 고치지 않는다.** 새 마이그레이션 하나로만 전달한다.
- 엔티티와 마이그레이션의 제약·인덱스 이름이 **글자까지 같아야 한다.** 하나라도 생략하면 TypeORM이 해시 이름을 만들어 어긋나고 `test/integration/migrations.spec.ts`의 드리프트 검사가 잡는다.
- 인덱스: `IDX_examples_published_at_id` 제거(컬럼이 사라진다), `IDX_examples_created_at_id`·`IDX_examples_title_id` 유지, `status`·`score`·`updatedAt`에 **새 인덱스를 만들지 않고** 그 근거를 `example.query-policy.ts` 선언부 주석에 남긴다.
- 참조 자원 조회 정책: filters `name`[exact, contains] / sorts `name` · `createdAt` / default `name ASC` / tie breaker `id ASC` / includes 없음.
- 참조 자원에 **새 인덱스를 만들지 않는다.** 근거가 "기존 인덱스로 커버된다"가 **아니다** — PostgreSQL은 유니크 제약을 근거로 뒤따르는 정렬 키를 지우지 않으므로 `ORDER BY name, id`에는 incremental sort가 남는다. 만들지 않는 실제 이유는 `name`이 유니크해서 동점 그룹이 항상 1이고 참조 테이블의 행 수가 작다는 것이다. 이 근거를 정책 선언부 주석에 남긴다.
- 참조 자원에 쓰기 라우트와 관계 라우트를 만들지 않는다.
- `fields[...]` 희소 필드셋을 추가하지 않는다.
- 자원별 service 계층을 만들지 않는다 — 이 저장소의 명시적 비목표다.
- 드리프트와 무관한 리팩터링을 하지 않는다.
- 검증 게이트는 `pnpm check`(= `./scripts/check.sh`) 하나다.

## 파일 구조

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `src/app/serializers/category.serializer.ts` (수정) | `type`을 `exampleCategories`로. Task 6에서 `resourcePath` 추가 | 1, 6 |
| `src/app/serializers/tag.serializer.ts` (수정) | `type`을 `exampleTags`로. Task 6에서 `resourcePath` 추가 | 1, 6 |
| `src/app/schemas/example.schemas.ts` (수정) | 관계 쓰기가 받는 `type`, 그리고 `description`·`score` 쓰기 계약 | 1, 2 |
| `src/db/migrations/20260904000000-align-example-schema-with-canon.ts` (생성) | 컬럼 rename·교체, enum 값 rename, 인덱스 제거 | 2 |
| `src/db/migrations/index.ts` (수정) | 새 마이그레이션 등록 | 2 |
| `src/app/models/example.entity.ts` (수정) | 컬럼·enum·인덱스·CHECK 제약 선언 | 2 |
| `src/app/serializers/example.serializer.ts` (수정) | `description`·`score` 출력 | 2 |
| `src/db/seeds.ts` (수정) | 결정적 시드를 새 스키마로 | 2 |
| `src/app/schemas/example.query-policy.ts` (수정) | 필터·정렬 목록, 기본 페이지 크기, 인덱스 판단 기록 | 3 |
| `src/app/controllers/concerns/crud-base.ts` (수정) | `enableWrites` 선언 계약 | 5 |
| `src/app/controllers/concerns/route-registrar.ts` (수정) | `enableWrites`가 거짓이면 쓰기 라우트를 등록하지 않는다 | 5 |
| `src/app/controllers/concerns/crud-actions.ts` (수정) | 읽기 전용 자원의 쓰기 스키마 요구를 푼다 | 5 |
| `src/app/schemas/category.query-policy.ts` (생성) | 분류 조회 허용 목록 + 인덱스 판단 기록 | 6 |
| `src/app/schemas/tag.query-policy.ts` (생성) | 라벨 조회 허용 목록 + 인덱스 판단 기록 | 6 |
| `src/app/controllers/api/v1/categories.controller.ts` (생성) | 선언만. 읽기 전용 | 6 |
| `src/app/controllers/api/v1/tags.controller.ts` (생성) | 선언만. 읽기 전용 | 6 |
| `src/config/routes.module.ts` (수정) | 두 컨트롤러 등록 | 6 |
| `src/app/schemas/index.ts` (수정) | 두 정책 export | 6 |

## 스펙이 나열하지 않은 드리프트 — Task 2에 포함한다

스펙 §2는 스스로를 "드리프트 전수 목록"이라 부르지만 하나를 빠뜨렸다. **`status`의 필수 여부**다.

| | 정본 | 이 저장소 |
| --- | --- | --- |
| `ExampleCreate.status` | 필수 (`status: Annotated[ExampleStatus, Field(strict=False)]`, 기본값 없음) | 선택 (`@ValidateIf(isPresent)` + `status?`) |
| `ExampleReplace.status` | 필수 | 선택 |
| `examples.status` 컬럼 기본값 | 없음 | `DEFAULT 'draft'` |

**wire에 그대로 드러난다.** `status` 없이 `POST /api/v1/examples`를 부르면 정본은 422, 이 저장소는 201이다. 스펙 §1의 목표("같은 요청에 같은 문서가 나온다")와 §8의 완료 조건("정본과의 응답 대조")이 이것을 요구하므로 Task 2에서 함께 고친다.

**DB 컬럼 기본값은 남긴다.** `status`가 스키마에서 필수가 되면 API를 통해서는 그 기본값에 도달할 수 없으므로 wire 차이가 사라진다. 기본값 자체를 지우려면 엔티티와 마이그레이션을 함께 손대야 하는데, 관측 가능한 이득이 없다 — "드리프트와 무관한 리팩터링을 하지 않는다"에 걸린다.

`ExampleUpdate.status`는 그대로 둔다. 정본도 PATCH에서는 sparse(`= MISSING`)이고, 이 저장소의 `@ValidateIf(isPresent)`가 같은 동작이다.

---

### Task 1: 자원 타입 이름

**Files:**
- Modify: `src/app/serializers/category.serializer.ts:16`
- Modify: `src/app/serializers/tag.serializer.ts:12`
- Modify: `src/app/schemas/example.schemas.ts:130-133`
- Test: `test/serializers/example.serializer.spec.ts`
- Test: `test/integration/examples-api.spec.ts`
- Test: `test/integration/examples-put.spec.ts`
- Test: `test/integration/relationship-resolver.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces:
  - `CATEGORY_SERIALIZER.type === 'exampleCategories'`, `TAG_SERIALIZER.type === 'exampleTags'`
  - `EXAMPLE_RELATIONSHIPS.category.type === 'exampleCategories'`, `EXAMPLE_RELATIONSHIPS.tags.type === 'exampleTags'`

이 태스크는 가장 작고 가장 파급이 크다. **고칠 자리가 둘이다** — 시리얼라이저(내보내는 쪽)와 `EXAMPLE_RELATIONSHIPS`(받는 쪽). 한쪽만 고치면 읽기가 내보낸 `type`을 쓰기가 거절하는 상태가 되고, 그 사고는 관계 쓰기 요청이 들어와야 드러난다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/serializers/example.serializer.spec.ts`의 세 곳을 고친다. 150-151행:

```ts
    expect(CATEGORY_SERIALIZER.type).toBe('exampleCategories');
    expect(TAG_SERIALIZER.type).toBe('exampleTags');
```

175-181행의 두 테스트 본문:

```ts
  it('category 관계 대상이 exampleCategories 시리얼라이저다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.category?.target().type).toBe('exampleCategories');
  });

  it('tags 관계 대상이 exampleTags 시리얼라이저다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.tags?.target().type).toBe('exampleTags');
  });
```

126행과 134-137행의 linkage 기대값:

```ts
    expect(object.relationships.category?.data).toEqual({ type: 'exampleCategories', id: 'c1' });
```

```ts
    expect(object.relationships.tags?.data).toEqual([
      { type: 'exampleTags', id: 't1' },
      { type: 'exampleTags', id: 't2' },
    ]);
```

197행 부근의 `SERIALIZERS` 구성 고정 테스트도 `'categories'`를 담고 있다. 그 배열의 기대값을 `'exampleCategories'`·`'exampleTags'`로 바꾼다.

같은 파일 맨 끝에 **쓰기 방향을 고정하는 테스트**를 새로 추가한다. 이것이 "한쪽만 고쳤다"를 잡는 장치다.

```ts
describe('읽기와 쓰기가 같은 자원 타입을 쓴다', () => {
  it('EXAMPLE_RELATIONSHIPS의 type이 시리얼라이저가 내보내는 type과 같다', () => {
    // 시리얼라이저는 내보내고 EXAMPLE_RELATIONSHIPS는 받는다. 둘이 갈라지면
    // 응답이 광고한 linkage를 그대로 되돌려보내는 요청이 409로 거절된다.
    expect(EXAMPLE_RELATIONSHIPS.category?.type).toBe(
      EXAMPLE_SERIALIZER.relationships.category?.target().type,
    );
    expect(EXAMPLE_RELATIONSHIPS.tags?.type).toBe(
      EXAMPLE_SERIALIZER.relationships.tags?.target().type,
    );
  });
});
```

이 테스트는 `EXAMPLE_RELATIONSHIPS` import가 필요하다. 파일 상단 import 블록에 더한다.

```ts
import { EXAMPLE_RELATIONSHIPS } from '../../src/app/schemas/example.schemas.js';
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/serializers/example.serializer.spec.ts`

Expected: FAIL. `Expected: "exampleCategories" / Received: "categories"` 형태로 여러 건.

- [ ] **Step 3: 시리얼라이저의 type을 바꾼다**

`src/app/serializers/category.serializer.ts`의 `type` 한 줄과 그 위 docstring의 한 문장:

```ts
export const CATEGORY_SERIALIZER: ResourceSerializer<Category> = {
  type: 'exampleCategories',
```

`src/app/serializers/tag.serializer.ts`:

```ts
export const TAG_SERIALIZER: ResourceSerializer<Tag> = {
  type: 'exampleTags',
```

두 파일의 docstring에 있는 "`resourcePath`가 없다 … 스펙 16장의 공개 API 표면에 `/api/v1/categories` 라우트가 없기 때문이다" 문단은 **이 태스크에서 건드리지 않는다.** Task 6이 그 라우트를 만들면서 함께 고친다 — 지금 고치면 라우트가 없는 동안 거짓이 된다.

- [ ] **Step 4: 쓰기 스키마가 받는 type을 바꾼다**

`src/app/schemas/example.schemas.ts`의 `EXAMPLE_RELATIONSHIPS`:

```ts
export const EXAMPLE_RELATIONSHIPS: RelationshipWriteSchema = {
  category: { cardinality: 'one', type: 'exampleCategories', model: Category },
  tags: { cardinality: 'many', type: 'exampleTags', model: Tag },
};
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/serializers/example.serializer.spec.ts`

Expected: PASS.

- [ ] **Step 6: 남은 기대값을 갱신한다**

Run: `pnpm exec jest --coverage=false`

`type: 'categories'` / `type: 'tags'`를 linkage로 보내거나 단언하는 곳이 실패한다. 실패는 아래 세 파일에서만 나온다.

```text
test/integration/examples-api.spec.ts       272 277 289 303 315 385 519 544 558 578 586 614 636 694행
test/integration/examples-put.spec.ts       190 217 222 261 300행
test/integration/relationship-resolver.spec.ts  38 60 61 82행
```

각 자리의 `'categories'` → `'exampleCategories'`, `'tags'` → `'exampleTags'`로 바꾼다. **JSON:API `type`인 자리만 바꾼다** — 아래는 바꾸지 않는다.

- `@Entity({ name: 'categories' })`·`@Entity({ name: 'tags' })` — 테이블 이름이다.
- `includes: ['category', 'tags']` — 관계 이름이다.
- `eagerLoad: 'tags'` — TypeORM 관계 프로퍼티 이름이다.
- 마이그레이션 SQL의 `"categories"`·`"tags"` — 테이블 이름이다.
- `test/integration/migrations.spec.ts:24`, `test/integration/migration-revert.spec.ts:128,132` — 테이블 이름이다.
- `test/controllers/crud-actions.spec.ts:46,52`의 `type: 'tags'` — 조립 시점 오류를 노리는 합성 프로브다. `CrudActions`의 조립 검사는 `cardinality`와 이름 존재만 비교하고 `type`은 보지 않으므로 이 값은 어디에도 닿지 않는다. 손대지 않는다.

- [ ] **Step 7: 전체 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false`

Expected: 전부 PASS.

- [ ] **Step 8: 타입 검사와 린트**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint . && pnpm exec prettier --check .`

Expected: 전부 통과.

- [ ] **Step 9: 커밋**

```bash
git add src/app/serializers/category.serializer.ts src/app/serializers/tag.serializer.ts src/app/schemas/example.schemas.ts test/
git commit -m "fix: align reference resource types with the canonical backend

categories/tags를 exampleCategories/exampleTags로 바꾼다. 정본과 Rails가
모두 이 이름을 쓰고 이 저장소만 달랐다 — 공유 프론트엔드에는 하드 브레이크다.

내보내는 쪽(시리얼라이저)과 받는 쪽(EXAMPLE_RELATIONSHIPS)을 함께 고친다.
한쪽만 고치면 응답이 광고한 linkage를 그대로 되돌려보내는 요청이 거절된다."
```

---

### Task 2: 리소스 스키마 통일

**Files:**
- Create: `src/db/migrations/20260904000000-align-example-schema-with-canon.ts`
- Modify: `src/db/migrations/index.ts`
- Modify: `src/app/models/example.entity.ts`
- Modify: `src/app/serializers/example.serializer.ts:22-29`
- Modify: `src/app/schemas/example.schemas.ts`
- Modify: `src/db/seeds.ts`
- Test: `test/integration/migrations.spec.ts`
- Test: `test/models/entities.spec.ts`
- Test: `test/schemas/example.schemas.spec.ts`
- Test: `test/serializers/example.serializer.spec.ts`
- Test: `test/integration/seeds.spec.ts`, `test/integration/upsert-executor.spec.ts`, `test/integration/examples-api.spec.ts`, `test/integration/examples-put.spec.ts`, `test/integration/query-compiler.spec.ts`, `test/jsonapi/filter.spec.ts`, `test/jsonapi/pagination.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `EXAMPLE_RELATIONSHIPS` 타입 이름 (건드리지 않는다)
- Produces:
  - `ExampleStatus = 'draft' | 'active' | 'archived'`, `EXAMPLE_STATUSES = ['draft', 'active', 'archived']`
  - `Example.description: string | null`, `Example.score: number`
  - `ExampleCreate { title!: string; description?: string | null; status!: ExampleStatus; score!: number }`
  - `ExampleUpdate { title?: string; description?: string | null; status?: ExampleStatus; score?: number }`
  - `ExampleReplace { title!: string; description?: string | null; status!: ExampleStatus; score!: number }`
  - `AlignExampleSchemaWithCanon1788480000000`

**이 태스크는 원자적이다.** 엔티티에서 `body`를 지우는 순간 시리얼라이저·쓰기 스키마·시드가 함께 컴파일되지 않으므로 나눌 수 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 마이그레이션 쪽**

`test/integration/migrations.spec.ts` 40행의 enum 레이블 기대값:

```ts
    expect(rows.map((row) => row.enumlabel)).toEqual(['active', 'archived', 'draft']);
```

(쿼리가 `ORDER BY enumlabel`이므로 알파벳순이다.)

같은 파일 43-53행의 인덱스 테스트에서 `published_at` 줄을 지우고, 사라졌음을 단언하는 줄을 더한다.

```ts
  it('정책이 여는 정렬마다 (컬럼, id) 인덱스를 만든다', async () => {
    // 위와 같은 이유로 스키마를 한정한다. 지금은 `toContain`이라 다른 스키마의 동명
    // 인덱스가 섞여도 통과하지만, 한정하지 않은 카탈로그 조회는 같은 함정을 남긴다.
    const rows = await dataSource.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'examples'`,
    );
    const names = rows.map((row) => row.indexname);
    expect(names).toContain('IDX_examples_created_at_id');
    expect(names).toContain('IDX_examples_title_id');
    // published_at 컬럼이 사라졌으므로 인덱스도 함께 사라져야 한다. 남아 있으면
    // 마이그레이션이 컬럼만 지우고 인덱스를 흘린 것이다.
    expect(names).not.toContain('IDX_examples_published_at_id');
  });
```

같은 파일 맨 끝에 `score` 제약을 고정하는 테스트를 더한다.

```ts
describe('score 범위 제약', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('CHK_examples_score_range 제약이 있다', async () => {
    const rows = await dataSource.query<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint
       JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE pg_class.relname = 'examples' AND pg_namespace.nspname = 'public'
         AND pg_constraint.contype = 'c'`,
    );
    expect(rows.map((row) => row.conname)).toContain('CHK_examples_score_range');
  });

  it('범위 밖의 score를 DB가 거절한다', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO "examples" ("title", "status", "score") VALUES ('범위 밖', 'draft', 101)`,
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/integration/migrations.spec.ts`

Expected: FAIL. enum 레이블이 `['archived', 'draft', 'published']`이고, `IDX_examples_published_at_id`가 아직 있고, `CHK_examples_score_range`가 없다.

이 파일은 실제 PostgreSQL이 필요하다. `TEST_DATABASE_URL`이 없으면 `pnpm db:up` 뒤 환경 변수를 주거나, `pnpm check`를 쓴다.

- [ ] **Step 3: 마이그레이션을 쓴다**

`src/db/migrations/20260904000000-align-example-schema-with-canon.ts`를 만든다.

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Example 스키마를 정본(`template-python-fastapi`)에 맞춘다.
 *
 * 클래스명 끝의 `1788480000000`은 `2026-09-04T00:00:00Z`의 epoch millis다. 파일명의
 * `20260904000000`과 같은 시각을 가리켜야 한다.
 *
 * `score`가 NOT NULL인데 기존 행이 있으므로 기본값을 주고 추가한 뒤 기본값을 뗀다.
 * 기본값을 남기면 엔티티(기본값 없음)와 어긋나 `migrations.spec.ts`의 드리프트
 * 검사가 잡는다.
 *
 * enum은 `ALTER TYPE ... RENAME VALUE`다. 값을 바꾸는 것이 아니라 이름만 바꾸므로
 * 기존 행이 그대로 따라온다.
 *
 * `down()`은 `up()`을 역순으로 되돌린다. `description`으로 rename한 컬럼을 `body`로
 * 되돌리고, `score`를 지우고 `published_at`과 그 인덱스를 되살린다 — `published_at`의
 * 값은 복구되지 않는다(컬럼을 지웠으므로 남아 있지 않다). 되돌릴 수 없는 마이그레이션을
 * 받지 않는다는 규칙은 "스키마를 되돌릴 수 있는가"에 대한 것이고, 지운 데이터가
 * 돌아오는 것을 뜻하지 않는다.
 */
export class AlignExampleSchemaWithCanon1788480000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "examples" RENAME COLUMN "body" TO "description"`);

    // 인덱스를 먼저 지운다. 컬럼을 지우면 인덱스가 함께 사라지지만, 순서를 명시해야
    // down()의 역순이 그대로 대칭이 된다.
    await queryRunner.query(`DROP INDEX "IDX_examples_published_at_id"`);
    await queryRunner.query(`ALTER TABLE "examples" DROP COLUMN "published_at"`);

    await queryRunner.query(
      `ALTER TABLE "examples" ADD COLUMN "score" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "examples" ALTER COLUMN "score" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "examples"
      ADD CONSTRAINT "CHK_examples_score_range" CHECK ("score" >= 0 AND "score" <= 100)
    `);

    await queryRunner.query(`ALTER TYPE "example_status" RENAME VALUE 'published' TO 'active'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "example_status" RENAME VALUE 'active' TO 'published'`);

    await queryRunner.query(
      `ALTER TABLE "examples" DROP CONSTRAINT "CHK_examples_score_range"`,
    );
    await queryRunner.query(`ALTER TABLE "examples" DROP COLUMN "score"`);

    await queryRunner.query(
      `ALTER TABLE "examples" ADD COLUMN "published_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_published_at_id" ON "examples" ("published_at", "id")
    `);

    await queryRunner.query(`ALTER TABLE "examples" RENAME COLUMN "description" TO "body"`);
  }
}
```

- [ ] **Step 4: 마이그레이션을 등록한다**

`src/db/migrations/index.ts`를 아래로 바꾼다. import 줄은 ESLint의 정렬 규칙에 맞춰 파일명 알파벳순이다.

```ts
import type { MigrationInterface } from 'typeorm';
import { AddExampleSortIndexes1788048000000 } from './20260830000000-add-example-sort-indexes.js';
import { AddRefreshSessionsReplacedByIndex1788367541000 } from './20260902164541-add-refresh-sessions-replaced-by-index.js';
import { AlignExampleSchemaWithCanon1788480000000 } from './20260904000000-align-example-schema-with-canon.js';
import { CreateAuthSchema1788307200000 } from './20260902000000-create-auth-schema.js';
import { CreateExampleSchema1787961600000 } from './20260829000000-create-example-schema.js';

/**
 * 마이그레이션 클래스.
 *
 * `Function`을 확장해 TypeORM `DataSourceOptions.migrations`가 요구하는 타입을 그대로
 * 만족시키면서, 생성자 시그니처와 `prototype`을 함께 선언한다. 그래서 호출하는 쪽이
 * 캐스트 없이 `new migration()`으로 인스턴스를 만들고 `migration.prototype.up`을 읽을 수
 * 있다 — `test/integration/migration-revert.spec.ts`가 `down()`을 실제로 실행하려면
 * 이 정도의 타입이 필요하다.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM의 migrations 옵션 타입이 Function이다
export interface MigrationClass extends Function {
  new (): MigrationInterface;
  readonly prototype: MigrationInterface;
}

/**
 * DataSource에 등록하는 마이그레이션의 유일한 목록.
 *
 * 엔티티와 같은 계약이다 — glob으로 탐색하지 않고, 이 배열에 없는 마이그레이션은
 * 실행되지 않는다. 새 마이그레이션을 만들면 파일 생성과 이 배열 추가가 한 커밋에 있어야
 * 한다. `test/db/migration-naming.spec.ts`가 디렉터리와 이 배열의 개수를 비교해 고정한다.
 *
 * 순서는 TypeORM이 클래스명 끝의 epoch millis로 정하므로 이 배열의 순서에 의존하지 않는다.
 */
export const MIGRATIONS: readonly MigrationClass[] = [
  CreateExampleSchema1787961600000,
  AddExampleSortIndexes1788048000000,
  CreateAuthSchema1788307200000,
  AddRefreshSessionsReplacedByIndex1788367541000,
  AlignExampleSchemaWithCanon1788480000000,
];
```

- [ ] **Step 5: 엔티티를 바꾼다**

`src/app/models/example.entity.ts`. import 줄에 `Check`를 더하고(알파벳순으로 `Column` 앞), 타입·상수·인덱스·컬럼을 바꾼다.

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from './category.entity.js';
import { Tag } from './tag.entity.js';

/** Example의 상태. 저장 형식은 PostgreSQL enum이다. */
export type ExampleStatus = 'draft' | 'active' | 'archived';

/** 허용되는 상태 값. 마이그레이션의 enum 정의와 이 배열이 같아야 한다. */
export const EXAMPLE_STATUSES: readonly ExampleStatus[] = ['draft', 'active', 'archived'];
```

클래스 데코레이터에서 `IDX_examples_published_at_id` 줄을 지우고 `@Check`를 더한다. docstring의 인덱스 문단도 사실에 맞게 고친다.

```ts
/**
 * 이 템플릿의 견본 자원.
 *
 * to-one(`category`)과 to-many(`tags`)를 모두 갖는 이유는 Phase 4의 관계 라우트
 * 등록이 두 cardinality를 모두 다루는지 이 자원 하나로 검증하기 위해서다.
 *
 * `(created_at, id)`·`(title, id)` 인덱스: 스펙 8.3에 따라 모든 정렬 뒤에 `id ASC`가
 * tie breaker로 덧붙으므로, 정렬이 실제로 인덱스를 타려면 두 컬럼이 함께 있어야 한다.
 *
 * `EXAMPLE_QUERY_POLICY.sorts`가 여는 정렬은 다섯이고 인덱스는 둘이다. 이 불일치는
 * 의도된 것이며 그 근거는 `example.query-policy.ts`의 선언부 주석에 있다 — 정본도
 * 기본 정렬 하나와 FK만 인덱싱한다.
 *
 * 이름을 명시하는 이유: 이름을 생략하면 TypeORM이 해시 이름을 만들어 마이그레이션이
 * 만든 `IDX_examples_created_at_id`와 어긋난다. `test/integration/migrations.spec.ts`의
 * "엔티티 메타데이터가 실제 스키마와 어긋나지 않는다" 테스트가 그 어긋남을 잡아낸다.
 * `@Check`의 이름도 같은 이유로 명시한다.
 */
@Index('IDX_examples_created_at_id', ['createdAt', 'id'])
@Index('IDX_examples_title_id', ['title', 'id'])
@Check('CHK_examples_score_range', `"score" >= 0 AND "score" <= 100`)
@Entity({ name: 'examples' })
export class Example {
```

컬럼 두 개를 바꾼다. `body` 자리:

```ts
  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;
```

`published_at` 자리 (선언 순서는 마이그레이션이 컬럼을 붙인 순서와 무관하다 — 여기서는 `status` 뒤 `created_at` 앞에 그대로 둔다):

```ts
  @Column({ name: 'score', type: 'integer' })
  score!: number;
```

`status` 컬럼의 `default: 'draft'`는 **그대로 둔다.** 컬럼 기본값을 지우면 마이그레이션이 하나 더 필요하고, 스키마에서 `status`가 필수가 된 뒤에는 API로 도달할 수 없어 관측 가능한 이득이 없다.

- [ ] **Step 6: 시리얼라이저를 바꾼다**

`src/app/serializers/example.serializer.ts`의 `attributes`:

```ts
  attributes: {
    title: (example) => example.title,
    description: (example) => example.description,
    status: (example) => example.status,
    score: (example) => example.score,
    createdAt: (example) => example.createdAt.toISOString(),
    updatedAt: (example) => example.updatedAt.toISOString(),
  },
```

정본의 attribute 순서(`title`, `description`, `status`, `score`, `createdAt`, `updatedAt`)를 그대로 쓴다. JSON 객체의 키 순서는 계약이 아니지만, 두 구현을 나란히 읽는 사람에게는 순서가 같은 편이 낫다.

- [ ] **Step 7: 쓰기 스키마를 바꾼다**

`src/app/schemas/example.schemas.ts`. import 줄에서 더 이상 쓰지 않는 `IsDate`·`Transform`을 빼고 `IsInt`·`Max`·`Min`을 더한다.

```ts
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { Category } from '../models/category.entity.js';
import { EXAMPLE_STATUSES } from '../models/example.entity.js';
import type { ExampleStatus } from '../models/example.entity.js';
import { Tag } from '../models/tag.entity.js';
import type { RelationshipWriteSchema } from './write-schema.js';
```

파일 머리 docstring의 "선택 필드를 여는 표기가 두 가지인 이유" 문단에서 컬럼 이름을 갱신한다.

```
 * - nullable 컬럼(`description`)은 `@IsOptional()`. `null`은 "비운다"는 뜻이다.
 * - NOT NULL 컬럼(`title`·`status`·`score`)은 `@ValidateIf(isPresent)`. 보내지 않은 것만
 *   건너뛰고 `null`은 검증기에 그대로 넘겨 422로 거절한다.
```

`toDate` 헬퍼 함수를 지운다 — `publishedAt`이 사라지면 쓰는 곳이 없다. `isPresent`는 남긴다.

세 클래스를 아래로 바꾼다.

```ts
/** `POST /api/v1/examples`의 본문 attributes. */
export class ExampleCreate {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  // 정본이 생성에서 `status`를 필수로 받는다. 컬럼에 DB 기본값이 있지만 그것에
  // 도달하는 경로를 열면 `status`를 생략한 같은 요청이 정본에서는 422, 여기서는
  // 201이 되어 wire가 갈라진다.
  @IsIn(EXAMPLE_STATUSES)
  status!: ExampleStatus;

  // 범위 검증을 스키마에도 건다. DB의 CHECK 제약만 있으면 위반이 500으로 나간다.
  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;
}

/**
 * `PATCH /api/v1/examples/{id}`의 본문 attributes.
 *
 * 모든 필드가 선택이다. 무엇을 실제로 바꿀지는 이 스키마가 아니라 요청이 보낸 키
 * 집합(`presentKeys`)이 정한다 — 스펙 7.1.
 */
export class ExampleUpdate {
  // 선택이지만 `null`은 아니다. 파일 머리의 대응 관계 참고 — `title` 컬럼이 NOT NULL이라
  // `@IsOptional()`을 쓰면 `{"title": null}`이 DB까지 내려가 500이 된다.
  @ValidateIf(isPresent)
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf(isPresent)
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  // `score`도 NOT NULL이므로 `@IsOptional()`이 아니라 `@ValidateIf(isPresent)`다.
  // `{"score": null}`은 사용자가 명시적으로 보낸 값이고 422로 거절해야 한다.
  @ValidateIf(isPresent)
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

/**
 * `PUT /api/v1/examples/{id}`의 본문 attributes.
 *
 * 전체 교체이므로 생성과 같은 필수 조건을 건다 — 보내지 않은 필드는 기본값으로
 * 돌아가고, 그것이 PATCH와 갈리는 지점이다.
 */
export class ExampleReplace {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsIn(EXAMPLE_STATUSES)
  status!: ExampleStatus;

  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;
}
```

- [ ] **Step 8: 시드를 바꾼다**

`src/db/seeds.ts`의 `ExampleSeed` 인터페이스와 `EXAMPLES` 배열, 그리고 `seed()`의 insert.

```ts
interface ExampleSeed {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'draft' | 'active' | 'archived';
  readonly score: number;
  readonly categoryId: string;
  readonly tagIds: readonly string[];
}
```

```ts
const EXAMPLES: readonly ExampleSeed[] = [
  {
    id: EXAMPLE_ID_LITERALS.gettingStarted,
    title: '시작하기',
    description: '이 템플릿으로 JSON:API 자원을 추가하는 방법을 설명한다.',
    status: 'active',
    // 시드는 결정적이어야 하므로 값을 고정한다. 두 행의 값이 다른 이유는
    // score 정렬을 손으로 확인할 때 순서가 정해지게 하려는 것이다.
    score: 80,
    categoryId: CATEGORY_ID_LITERALS.guides,
    tagIds: [TAG_ID_LITERALS.jsonapi, TAG_ID_LITERALS.nestjs],
  },
  {
    id: EXAMPLE_ID_LITERALS.queryPolicy,
    title: '조회 정책',
    description: 'filter·sort·include 허용 목록을 선언하는 방법을 설명한다.',
    status: 'draft',
    score: 40,
    categoryId: CATEGORY_ID_LITERALS.references,
    tagIds: [TAG_ID_LITERALS.postgres],
  },
];
```

`seed()`의 Example insert:

```ts
  await manager
    .createQueryBuilder()
    .insert()
    .into(Example)
    .values(
      EXAMPLES.map((example) => ({
        id: example.id,
        title: example.title,
        description: example.description,
        status: example.status,
        score: example.score,
        categoryId: example.categoryId,
      })),
    )
    .orUpdate(['title', 'description', 'status', 'score', 'category_id'], ['id'])
    .execute();
```

- [ ] **Step 9: 남은 기대값을 갱신한다**

Run: `pnpm exec jest --coverage=false`

`publishedAt` · `published_at` · `'published'` · `body`를 쓰는 테스트가 실패한다. 아래에서만 나온다.

```text
test/models/entities.spec.ts
test/schemas/example.schemas.spec.ts
test/serializers/example.serializer.spec.ts
test/integration/seeds.spec.ts
test/integration/upsert-executor.spec.ts
test/integration/examples-api.spec.ts
test/integration/examples-put.spec.ts
test/integration/query-compiler.spec.ts
test/jsonapi/filter.spec.ts
test/jsonapi/pagination.spec.ts
test/jsonapi/cursor.spec.ts
test/jsonapi/query.spec.ts
test/jsonapi/sort.spec.ts
```

기계적 치환은 셋이다.

- `body` → `description` (attribute 이름)
- `publishedAt` → `score` (attribute 이름). 값은 ISO 문자열이 아니라 0~100 정수다.
- `'published'` → `'active'` (status 값)

**기계적이지 않은 것이 둘 있다.** 이 둘은 Task 3이 정책을 바꾸기 전까지 정책과 어긋나므로, 여기서는 정책에 맞춰 두고 Task 3이 다시 손댄다.

1. **`publishedAt` 정렬을 쓰는 테스트** — `test/jsonapi/sort.spec.ts`, `test/jsonapi/cursor.spec.ts`, `test/jsonapi/query.spec.ts`가 `sort=publishedAt`으로 nullable 정렬 거부를 실증한다. `publishedAt` 컬럼이 사라졌으므로 정렬 자체가 성립하지 않는다. **이 태스크에서는 그 테스트들을 지우지 않는다** — `EXAMPLE_QUERY_POLICY`는 Task 3까지 `publishedAt`을 그대로 들고 있고, 정책은 컬럼 존재를 검사하지 않으므로 파서 단위 테스트는 계속 통과한다. 실제 DB를 타는 것만 실패하므로 그것만 고친다.

2. **`POST`/`PUT` 본문에 `status`·`score`가 없는 테스트** — 이제 422가 된다. 두 필드를 본문에 더한다. `status`가 필수가 된 것은 이 계획 머리의 "스펙이 나열하지 않은 드리프트"이며, 그 자체가 이 태스크의 검증 대상이다.

`test/schemas/example.schemas.spec.ts`에 아래 두 테스트를 새로 더한다 (기존 `describe` 블록 안, `validateAttributes` 헬퍼를 이미 쓰는 자리와 같은 방식으로).

```ts
  it('생성에서 status를 생략하면 거절한다', async () => {
    // 정본이 생성에서 status를 필수로 받는다. 여기서 선택이면 같은 요청이
    // 정본에서는 422, 여기서는 201이 되어 wire가 갈라진다.
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', score: 10 }),
    ).rejects.toThrow();
  });

  it('score 범위 밖을 거절한다', async () => {
    // DB의 CHECK 제약만 있으면 위반이 500으로 나간다. 스키마에서 먼저 잡는다.
    await expect(
      validateAttributes(ExampleCreate, {
        title: '제목',
        status: 'draft',
        score: 101,
      }),
    ).rejects.toThrow();
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', status: 'draft', score: -1 }),
    ).rejects.toThrow();
  });
```

`validateAttributes`의 실제 시그니처와 거절 방식(throw인지 반환값인지)은 그 파일이 이미 쓰는 형태를 그대로 따른다. 다르면 그 형태에 맞춘다 — 새 헬퍼를 만들지 않는다.

`test/integration/examples-api.spec.ts`에 스키마 계약을 wire에서 확인하는 테스트를 하나 더한다.

```ts
  it('score 범위 밖의 생성을 422로 거절한다', async () => {
    const response = await authorizedPost({
      title: '범위 밖',
      status: 'draft',
      score: 101,
    });

    expect(response.status).toBe(422);
  });
```

이 파일이 이미 쓰는 인증된 POST 헬퍼의 실제 이름을 쓴다. 없으면 그 파일의 기존 `POST` 테스트가 하는 방식을 그대로 복제한다.

- [ ] **Step 10: 전체 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false`

Expected: 전부 PASS.

- [ ] **Step 11: 타입 검사와 린트**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint . && pnpm exec prettier --check .`

Expected: 전부 통과.

- [ ] **Step 12: 커밋**

```bash
git add src/db/migrations/ src/app/models/example.entity.ts src/app/serializers/example.serializer.ts src/app/schemas/example.schemas.ts src/db/seeds.ts test/
git commit -m "feat: align the example resource schema with the canonical backend

body를 description으로 rename하고, published_at을 score(NOT NULL,
CHECK 0..100)로 바꾸고, status 값 published를 active로 rename한다.
published_at이 사라지므로 그 인덱스도 함께 지운다.

status를 생성·교체에서 필수로 만든다. 스펙 2장의 드리프트 목록에는 없지만
정본이 필수로 받고 있어서, 생략한 요청이 정본에서는 422 여기서는 201이었다.

이미 적용된 마이그레이션은 고치지 않고 새 마이그레이션 하나로 전달한다.
score는 기존 행 때문에 기본값을 주고 추가한 뒤 기본값을 뗀다 — 기본값을
남기면 엔티티와 어긋나 드리프트 검사가 잡는다."
```

---

### Task 3: 쿼리 정책·인덱스 판단·기본 페이지 크기

**Files:**
- Modify: `src/app/schemas/example.query-policy.ts`
- Test: `test/schemas/example.query-policy.spec.ts`
- Test: `test/integration/examples-api.spec.ts`
- Test: `test/jsonapi/sort.spec.ts`, `test/jsonapi/cursor.spec.ts`, `test/jsonapi/query.spec.ts`, `test/jsonapi/filter.spec.ts`, `test/jsonapi/pagination.spec.ts`, `test/integration/query-compiler.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `Example.score`, `Example.description`, `EXAMPLE_STATUSES`
- Produces: `EXAMPLE_QUERY_POLICY`가 스펙 §2.3의 목표 상태와 같아진다. `defaultPageSize === 20`. `sorts`에 `id`와 `publishedAt`이 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/schemas/example.query-policy.spec.ts`를 아래 단언들로 갱신한다. 기존 테스트가 `publishedAt`·`id`·`category`를 단언하는 자리를 대체한다.

```ts
  it('스펙이 정한 필터만 연다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.filters).sort()).toEqual([
      'category.id',
      'createdAt',
      'score',
      'status',
      'title',
    ]);
  });

  it('스펙이 정한 정렬만 연다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.sorts).sort()).toEqual([
      'createdAt',
      'score',
      'status',
      'title',
      'updatedAt',
    ]);
  });

  it('id는 tie breaker 전용이고 공개 정렬이 아니다', () => {
    // 정본의 공개 정렬에 id가 없다. 열어 두면 `sort=id`가 200을 내고 정본은
    // INVALID_SORT를 내어 wire가 갈라진다.
    expect(EXAMPLE_QUERY_POLICY.sorts.id).toBeUndefined();
    expect(EXAMPLE_QUERY_POLICY.tieBreaker).toEqual({ field: 'id', direction: 'ASC' });
  });

  it('category.id 필터가 FK 컬럼을 가리킨다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters['category.id']).toEqual({
      property: 'categoryId',
      type: 'uuid',
      operators: ['exact', 'in', 'isNull'],
    });
  });

  it('createdAt 필터가 exact를 연다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters.createdAt?.operators).toEqual([
      'exact',
      'gt',
      'gte',
      'lt',
      'lte',
    ]);
  });

  it('score 필터가 여섯 연산자를 연다', () => {
    expect(EXAMPLE_QUERY_POLICY.filters.score?.operators).toEqual([
      'exact',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
    ]);
  });

  it('기본 페이지 크기가 정본과 같은 20이다', () => {
    // page[size] 없이 목록을 부르면 25건과 20건으로 갈린다. wire에 그대로 드러난다.
    expect(EXAMPLE_QUERY_POLICY.defaultPageSize).toBe(20);
  });

  it('nullable 정렬을 열지 않는다', () => {
    for (const sort of Object.values(EXAMPLE_QUERY_POLICY.sorts)) {
      expect(sort?.nullable).toBe(false);
    }
  });
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/schemas/example.query-policy.spec.ts`

Expected: FAIL. 필터 키에 `category`·`publishedAt`이 있고 `category.id`·`score`가 없다. 정렬 키에 `id`·`publishedAt`이 있고 `status`·`score`·`updatedAt`이 없다. `defaultPageSize`가 25다.

- [ ] **Step 3: 정책을 바꾼다**

`src/app/schemas/example.query-policy.ts`를 아래 내용으로 바꾼다.

```ts
import { EXAMPLE_STATUSES } from '../models/example.entity.js';
import type { QueryPolicy } from './query-policy.js';

/**
 * Example의 조회 허용 목록.
 *
 * **인덱스 판단 (스펙 8.3)** — 모든 정렬 뒤에 `id ASC`가 붙으므로 유용한 인덱스는
 * `(<컬럼>, id)`다.
 *
 * - `createdAt` 정렬: `IDX_examples_created_at_id`가 초기 스키마에 이미 있다.
 * - `title` 정렬: `IDX_examples_title_id`가 있다.
 * - `status`·`score`·`updatedAt` 정렬: 인덱스를 **만들지 않는다.** `status`는 값이 3종,
 *   `score`는 0~100 정수로 둘 다 선택도가 낮아 플래너가 순차 스캔을 고르기 쉽다.
 *   `updatedAt`은 정본도 인덱싱하지 않는다 — 목록의 주 부하 경로가 아니다. 정본은
 *   기본 정렬 하나와 FK만 인덱싱하며, 이 저장소가 그보다 많이 갖고 있던 쪽이다.
 * - `status`·`category.id` 필터: 인덱스를 만들지 않는다. 위와 같은 이유이고, 정렬을
 *   동반한 목록 조회는 `(정렬 컬럼, id)` 인덱스가 이미 이끈다. 분류 수가 크게 늘거나
 *   특정 상태만 조회하는 경로가 주된 부하가 되면 그때 `(category_id, created_at, id)`
 *   같은 복합 인덱스를 같은 규칙으로 판단해 추가한다.
 * - `title`의 `contains`는 `LIKE '%...%'`로 컴파일되어 어떤 btree도 못 탄다. pg_trgm
 *   도입은 실제 사용 패턴이 정당화할 때까지 미루고, 연산자는 공개 허용 목록에 남긴다.
 *
 * **`id`는 정렬 목록에 없다.** tie breaker 전용이다 — 정본의 공개 정렬에 `id`가 없고,
 * 열어 두면 `sort=id`가 여기서만 200을 낸다.
 */
export const EXAMPLE_QUERY_POLICY: QueryPolicy = {
  filters: {
    title: { property: 'title', type: 'string', operators: ['exact', 'contains'] },
    status: {
      property: 'status',
      type: 'enum',
      operators: ['exact', 'in'],
      values: EXAMPLE_STATUSES,
    },
    score: {
      property: 'score',
      type: 'number',
      operators: ['exact', 'gt', 'gte', 'lt', 'lte', 'in'],
    },
    // 공개 이름은 `<관계>.id`, property는 FK 컬럼이다. 내부 컬럼 이름을 공개 표면에
    // 올리지 않으면서도 관계로 거를 수 있게 한다. 정본이 쓰는 이름이 `category.id`다.
    'category.id': {
      property: 'categoryId',
      type: 'uuid',
      operators: ['exact', 'in', 'isNull'],
    },
    createdAt: {
      property: 'createdAt',
      type: 'timestamp',
      operators: ['exact', 'gt', 'gte', 'lt', 'lte'],
    },
  },
  sorts: {
    title: { property: 'title', nullable: false },
    status: { property: 'status', nullable: false },
    score: { property: 'score', nullable: false },
    createdAt: { property: 'createdAt', nullable: false },
    updatedAt: { property: 'updatedAt', nullable: false },
  },
  includes: ['category', 'tags'],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 20,
};
```

`score`의 `type`이 `'number'`인 것을 확인한다 — `FilterValueType`에 `'integer'`가 없다(`query-policy.ts:38`). 스펙 §2.3의 표는 `integer`라 적었지만 이 저장소의 타입 유니온에는 `number`가 그 자리다. 유니온을 늘리지 않는다 — 드리프트와 무관한 변경이다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/schemas/example.query-policy.spec.ts`

Expected: PASS.

- [ ] **Step 5: 정책에 의존하던 테스트를 갱신한다**

Run: `pnpm exec jest --coverage=false`

`EXAMPLE_QUERY_POLICY`를 실제로 쓰는 테스트가 실패한다.

- `filter[category]=...`를 쓰는 곳 → `filter[category.id]=...`
- `filter[publishedAt][...]`를 쓰는 곳 → 그 테스트가 무엇을 검증하는지 보고 결정한다. 시간 범위 필터 자체를 검증하는 것이면 `filter[createdAt][gte]`로 옮긴다. `publishedAt`이라는 필드 자체를 검증하는 것이면 지운다.
- `sort=publishedAt` → **Task 4가 대체를 만든다.** 여기서는 `sort=publishedAt`이 `INVALID_SORT`가 되는 것을 확인하는 테스트로 바꾸고, nullable 정렬 거부의 검증은 Task 4로 넘긴다.
- `sort=id` → `INVALID_SORT`가 되는 것을 확인하는 테스트로 바꾼다.

`test/integration/examples-api.spec.ts`에 정책 계약을 wire에서 고정하는 테스트를 더한다.

```ts
  it('제거된 publishedAt filter를 INVALID_FILTER로 거절한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/examples?filter[publishedAt][gte]=2026-01-01T00:00:00Z')
      .set('Accept', JSONAPI_MEDIA_TYPE);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_FILTER');
  });

  it('제거된 publishedAt sort를 INVALID_SORT로 거절한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/examples?sort=publishedAt')
      .set('Accept', JSONAPI_MEDIA_TYPE);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_SORT');
  });

  it('id를 공개 정렬로 받지 않는다', async () => {
    // tie breaker 전용이다. 정본의 공개 정렬에 id가 없다.
    const response = await request(app.getHttpServer())
      .get('/api/v1/examples?sort=id')
      .set('Accept', JSONAPI_MEDIA_TYPE);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_SORT');
  });

  it('새 filter와 sort가 전부 2xx다', async () => {
    const queries = [
      'filter[title]=x',
      'filter[title][contains]=x',
      'filter[status]=draft',
      'filter[status][in]=draft,active',
      'filter[score]=10',
      'filter[score][gte]=0',
      'filter[score][in]=10,20',
      'filter[category.id][isNull]=true',
      'filter[createdAt]=2026-01-01T00:00:00Z',
      'filter[createdAt][gte]=2026-01-01T00:00:00Z',
      'sort=title',
      'sort=status',
      'sort=score',
      'sort=createdAt',
      'sort=updatedAt',
      'sort=-score,title',
    ];

    for (const query of queries) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/examples?${query}`)
        .set('Accept', JSONAPI_MEDIA_TYPE);

      expect([query, response.status]).toEqual([query, 200]);
    }
  });
```

`request`·`JSONAPI_MEDIA_TYPE`·`ErrorBody`의 실제 이름은 그 파일이 이미 쓰는 것을 그대로 쓴다. 배열을 단언에 함께 담는 것은 어느 쿼리에서 실패했는지 실패 메시지가 말하게 하려는 것이다.

기본 페이지 크기도 wire에서 고정한다.

```ts
  it('page[size] 없는 목록이 20건을 낸다', async () => {
    // 21건 이상을 만들어 기본값이 실제로 자르는지 본다. 20건 이하면 정책이
    // 25든 20이든 같은 결과가 나와 테스트가 아무것도 고정하지 못한다.
    await seedExamples(21);

    const response = await request(app.getHttpServer())
      .get('/api/v1/examples')
      .set('Accept', JSONAPI_MEDIA_TYPE);

    expect(response.status).toBe(200);
    expect((response.body as CollectionBody).data).toHaveLength(20);
  });
```

`seedExamples(n)`은 이 파일에 없으면 만든다 — 기존 테스트가 Example을 만드는 방식을 그대로 반복하는 루프 하나다. 다른 테스트가 만든 행이 남아 있지 않도록 이 파일이 이미 쓰는 격리 방식(트랜잭션 롤백 또는 truncate)을 따른다.

- [ ] **Step 6: 전체 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false`

Expected: 전부 PASS.

- [ ] **Step 7: 타입 검사와 린트**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint . && pnpm exec prettier --check .`

Expected: 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add src/app/schemas/example.query-policy.ts test/
git commit -m "fix: align the example query policy with the canonical backend

filter 이름 category를 category.id로 바꾸고, createdAt에 exact를 열고,
score 필터를 열고, publishedAt filter/sort를 지운다. 정렬 목록을
title/status/score/createdAt/updatedAt으로 맞춘다.

id를 공개 정렬에서 뺀다. tie breaker 전용이다 — 정본의 공개 정렬에 id가 없다.

기본 페이지 크기를 25에서 20으로 바꾼다. page[size] 없이 목록을 부르면
25건과 20건으로 갈려 wire에 그대로 드러났다.

status·score·updatedAt 정렬에 인덱스를 만들지 않는 근거를 선언부 주석에
남긴다 — 정렬을 여는 변경은 인덱스를 진다는 규칙이 요구하는 것은 인덱스
자체가 아니라 이 판단의 기록이다."
```

---

### Task 4: nullable 정렬 커서 거부 검증 대체

**Files:**
- Modify: `test/jsonapi/cursor.spec.ts`
- Test: 위 파일

**Interfaces:**
- Consumes: Task 3이 `EXAMPLE_QUERY_POLICY.sorts`에서 nullable 정렬을 없앤 상태
- Produces: 없음 (검증만)

`publishedAt`은 nullable이었고 "keyset cursor는 nullable 정렬을 거부한다"는 규칙을 실증하는 **유일한** 자원이었다. 제거하면 그 검증이 사라진다.

정본이 이 문제를 이미 풀어 놓았다 — 공개 정책에 nullable 정렬을 두지 않고, 테스트에서 합성 정책을 만들어 검증한다(`tests/jsonapi/test_query.py::test_cursor_is_rejected_for_a_nullable_sort_column`). 같은 방식을 쓴다. 공개 계약을 검증 편의로 오염시키지 않는다는 점에서 지금보다 낫다.

- [ ] **Step 1: 합성 정책 테스트를 쓴다**

`test/jsonapi/cursor.spec.ts` 맨 끝에 더한다.

```ts
describe('nullable 정렬과 커서', () => {
  /**
   * nullable 정렬을 여는 합성 정책.
   *
   * 공개 자원 중 nullable 정렬을 여는 것이 하나도 없다 — 정본과 같은 결정이다.
   * 그래서 이 규칙은 실제 정책이 아니라 여기서 만든 정책으로 검증한다. 검증 편의를
   * 위해 공개 계약에 nullable 정렬을 되돌려 놓지 않는다.
   */
  const NULLABLE_SORT_POLICY: QueryPolicy = {
    filters: {},
    sorts: {
      title: { property: 'title', nullable: false },
      // 이 하나가 이 describe 블록의 전부다.
      description: { property: 'description', nullable: true },
    },
    includes: [],
    defaultSort: [{ field: 'title', direction: 'ASC' }],
    tieBreaker: { field: 'id', direction: 'ASC' },
    defaultPageSize: 20,
  };

  it('nullable 정렬에 커서를 쓰면 INVALID_PAGE로 거절한다', () => {
    // keyset은 `(컬럼, id) > (값, 값)` 비교로 자르는데 NULL이 섞이면 비교가
    // unknown이 되어 행을 조용히 건너뛴다. 조용히 틀린 페이지보다 거절이 낫다.
    expect(() =>
      parseQuery({ sort: 'description', 'page[after]': '' }, NULLABLE_SORT_POLICY, []),
    ).toThrow(expect.objectContaining({ code: 'INVALID_PAGE' }));
  });

  it('같은 정렬도 offset 모드에서는 받는다', () => {
    // 거부되는 것은 커서 모드뿐이다. 규칙이 정렬 자체를 막는 것으로 넓어지면
    // 이 테스트가 잡는다.
    expect(() =>
      parseQuery({ sort: 'description', 'page[number]': '1' }, NULLABLE_SORT_POLICY, []),
    ).not.toThrow();
  });

  it('nullable이 아닌 정렬에는 커서를 허용한다', () => {
    expect(() =>
      parseQuery({ sort: 'title', 'page[after]': '' }, NULLABLE_SORT_POLICY, []),
    ).not.toThrow();
  });
});
```

`parseQuery`·`QueryPolicy` import가 이 파일에 없으면 상단에 더한다.

```ts
import { parseQuery } from '../../src/app/jsonapi/query.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';
```

`toThrow(expect.objectContaining({ code: 'INVALID_PAGE' }))`의 형태는 이 저장소가 `JsonApiError`를 단언하는 기존 방식을 그대로 쓴다. 다르면 그 방식에 맞춘다 — 오류 코드를 확인하지 않고 `toThrow()`만 쓰지 않는다. 어떤 이유로든 던지기만 하면 통과하는 단언은 이 규칙을 고정하지 못한다.

- [ ] **Step 2: 커서 코덱의 왕복 불가 타입 거부도 단위 테스트로 옮긴다**

`test/jsonapi/cursor.spec.ts`에서 `publishedAt`(`Date` 값)을 쓰던 코덱 테스트가 있으면, 같은 성질을 `Date`가 아닌 값으로 다시 표현한다. 커서 코덱은 정렬 값을 문자열로 인코딩했다가 되읽으므로, 왕복시킬 수 없는 값이 오면 거절해야 한다.

이 파일의 기존 코덱 테스트가 무엇을 어떻게 단언하는지 먼저 읽고, `publishedAt`이라는 이름만 바꿔도 성립하면 이름만 바꾼다. 컬럼이 `Date`라는 사실에 의존하고 있으면 위 합성 정책과 같은 방식으로 그 자리에서 값을 만든다.

- [ ] **Step 3: 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/jsonapi/cursor.spec.ts`

Expected: PASS.

> 이 태스크에는 red 단계가 없는 것이 정상이다 — 검증 규칙 자체는 이미 구현되어 있고, 그것을 실증하던 자원이 Task 3에서 사라졌을 뿐이다. 실패가 나오면 그것은 이 테스트의 red가 아니라 커서 구현의 버그이거나 합성 정책의 오류다.

레드를 실제로 확인하려면 `src/app/jsonapi/pagination.ts`(또는 nullable 검사를 하는 자리)에서 그 분기를 잠깐 지우고 이 테스트가 실패하는 것을 본 뒤 되돌린다. **확인했다는 사실을 보고에 적는다** — 이 태스크의 유일한 위험은 아무것도 검증하지 않는 테스트를 남기는 것이다.

- [ ] **Step 4: 전체 테스트와 게이트**

Run: `pnpm exec jest --coverage=false && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint . && pnpm exec prettier --check .`

Expected: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add test/jsonapi/cursor.spec.ts
git commit -m "test: keep the nullable-sort cursor rule covered by a synthetic policy

publishedAt은 nullable 정렬 거부를 실증하는 유일한 자원이었고 정책에서
사라졌다. 정본과 같은 방식으로 테스트 안에서 합성 정책을 만들어 검증한다.

공개 계약에 nullable 정렬을 되돌려 놓지 않는다 — 검증 편의로 계약을
오염시키지 않는 편이 지금보다 낫다."
```

---

### Task 5: `CrudActions`에 `enableWrites` 옵션

**Files:**
- Modify: `src/app/controllers/concerns/crud-base.ts`
- Modify: `src/app/controllers/concerns/crud-actions.ts`
- Modify: `src/app/controllers/concerns/route-registrar.ts:97-156`
- Modify: `src/app/controllers/concerns/AGENTS.md`
- Test: `test/controllers/route-registrar.spec.ts`
- Test: `test/controllers/crud-actions.spec.ts`

**Interfaces:**
- Consumes: 없음 (Task 1~4와 독립)
- Produces:
  - `CrudDeclaration.enableWrites?: boolean` — 기본은 `true`
  - `CrudDeclaration.createSchema` · `updateSchema` · `relationshipsSchema`가 선택이 된다
  - `enableWrites: false`면 `create`·`update`·`destroy`·`replace`와 관계 mutation 라우트가 등록되지 않는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/controllers/route-registrar.spec.ts`에 추가한다. 이 파일이 이미 쓰는 프로브 생성 헬퍼(`hostFor` 계열)와 라우트 수집 방식을 그대로 쓴다.

```ts
  it('enableWrites가 거짓이면 읽기 라우트만 만든다', () => {
    const host = hostFor({ enableWrites: false });

    expect(routeSignatures(host)).toEqual(['GET ', 'GET :id']);
  });

  it('enableWrites가 거짓이면 관계 쓰기 라우트도 만들지 않는다', () => {
    // 관계 쓰기는 relationshipsSchema가 여는데, 읽기 전용 자원이 그것을 선언했더라도
    // 열려서는 안 된다. 이 단언이 그 구멍을 지킨다.
    const host = hostFor({ enableWrites: false, relationshipsSchema: EXAMPLE_RELATIONSHIPS });

    for (const signature of routeSignatures(host)) {
      expect(signature.startsWith('GET ')).toBe(true);
    }
  });

  it('enableWrites 기본값이 참이라 기존 자원의 라우트가 그대로다', () => {
    const host = hostFor({});

    const signatures = routeSignatures(host);
    expect(signatures).toContain('POST ');
    expect(signatures).toContain('PATCH :id');
    expect(signatures).toContain('DELETE :id');
  });
```

`routeSignatures`가 이 파일에 없으면, 이 파일이 이미 라우트를 확인하는 방식(프로토타입의 메서드 존재 확인 또는 Nest 메타데이터 읽기)을 그대로 쓴다. **새 헬퍼를 만들 필요가 있으면 만들되, 그 헬퍼가 기존 테스트에서도 같은 답을 내는지 먼저 확인한다.**

`test/controllers/crud-actions.spec.ts`에 조립 검사를 추가한다.

```ts
  it('enableWrites가 거짓이면 쓰기 스키마 없이도 조립된다', () => {
    expect(() =>
      CrudActions({
        model: Example,
        serializer: EXAMPLE_SERIALIZER,
        queryPolicy: EXAMPLE_QUERY_POLICY,
        enableWrites: false,
      }),
    ).not.toThrow();
  });

  it('enableWrites가 참인데 createSchema가 없으면 조립 시점에 던진다', () => {
    // 라우트만 열리고 검증이 비는 상태가 조용히 만들어지는 것을 막는다.
    // `enableUpsert`/`replaceSchema`가 같은 모양의 선례다.
    expect(() =>
      CrudActions({
        model: Example,
        serializer: EXAMPLE_SERIALIZER,
        queryPolicy: EXAMPLE_QUERY_POLICY,
        updateSchema: ExampleUpdate,
      } as never),
    ).toThrow(TypeError);
  });
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/controllers/route-registrar.spec.ts test/controllers/crud-actions.spec.ts`

Expected: FAIL. `enableWrites`가 아직 선언 타입에 없어 타입 오류가 나거나, 쓰기 라우트가 그대로 등록된다.

- [ ] **Step 3: 선언 계약을 바꾼다**

`src/app/controllers/concerns/crud-base.ts`의 `CrudDeclaration`에서 세 필드를 선택으로 바꾸고 `enableWrites`를 더한다.

```ts
  readonly model: EntityTarget<T>;
  readonly serializer: ResourceSerializer<T>;
  /**
   * `POST` 본문의 attributes 스키마.
   *
   * `enableWrites`가 거짓이면 쓰기 라우트가 없으므로 선언하지 않아도 된다. 참인데
   * 없으면 조립 시점에 던진다 — `enableUpsert`/`replaceSchema`와 같은 계약이다.
   */
  readonly createSchema?: ClassConstructor<C>;
  /** `PATCH` 본문의 attributes 스키마. 모든 필드가 선택이어야 한다. */
  readonly updateSchema?: ClassConstructor<U>;
  /**
   * `PUT` 본문의 attributes 스키마. Phase 5의 upsert가 쓴다.
   *
   * `enableUpsert`가 참인데 이 값이 없으면 조립 시점에 던진다 — 라우트만 열리고
   * 검증이 비는 상태가 조용히 만들어지는 것을 막는다.
   */
  readonly replaceSchema?: ClassConstructor<object>;
  /**
   * 쓰기로 여는 관계.
   *
   * 여기 없는 관계는 읽기 전용이 된다 — 시리얼라이저가 선언했다면 `GET` 두 개는
   * 그대로 열리고 `PATCH`/`POST`/`DELETE`만 생기지 않는다. 반대로 시리얼라이저가
   * 선언하지 않은 이름을 여기 적으면 조립 시점에 던진다(`crud-actions.ts` 참고).
   *
   * 생략하면 빈 객체와 같다 — 관계 쓰기 라우트가 하나도 생기지 않는다.
   */
  readonly relationshipsSchema?: RelationshipWriteSchema;
  readonly queryPolicy: QueryPolicy;
  /** `PUT` 라우트를 열지. 기본은 열지 않는다. */
  readonly enableUpsert?: boolean;
  /**
   * 쓰기 라우트를 등록할지. 기본은 등록한다.
   *
   * 거짓이면 `create`·`update`·`destroy`·`replace`와 관계 mutation 라우트가 생기지
   * 않고, `createSchema`·`updateSchema`·`relationshipsSchema`를 선언하지 않아도 된다.
   * 참조 데이터처럼 서버가 관리하는 자원을 위한 것이다.
   *
   * 쓰기 메서드는 라우트 자체가 없어 405가 나간다 — `@Controller` 경로는 있고 그
   * 경로의 다른 메서드가 있기 때문이다. 그것이 "이 자원은 쓰기를 지원하지 않는다"의
   * 정확한 답이다.
   */
  readonly enableWrites?: boolean;
```

- [ ] **Step 4: 라우트 등록기가 옵션을 존중하게 한다**

`src/app/controllers/concerns/route-registrar.ts`의 `registerRoutes`에서 `index`·`show` 등록은 그대로 두고, 나머지를 조건 안으로 옮긴다.

```ts
export function registerRoutes<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
>(host: Type<object>, declaration: CrudDeclaration<T, C, U>): void {
  const prototype: unknown = host.prototype;
  if (!isPrototypeObject(prototype)) {
    throw new TypeError(`${host.name}의 prototype이 객체가 아니다`);
  }
  const proto = prototype;
  const enableWrites = declaration.enableWrites !== false;
  const writeMethods: string[] = enableWrites ? ['create', 'update', 'destroy'] : [];

  decorate(proto, 'index', (descriptor) => {
    Get()(proto, 'index', descriptor);
    Query()(proto, 'index', 0);
  });

  decorate(proto, 'show', (descriptor) => {
    Get(':id')(proto, 'show', descriptor);
    Param('id')(proto, 'show', 0);
    Query()(proto, 'show', 1);
  });

  // 쓰기 라우트는 선언이 켠 자원에만 생긴다. 읽기 전용 자원에서 POST/PATCH/DELETE를
  // 부르면 그 경로에 그 메서드가 없어 405가 나가고, 그것이 정확한 답이다.
  if (enableWrites) {
    decorate(proto, 'create', (descriptor) => {
      Post()(proto, 'create', descriptor);
      HttpCode(201)(proto, 'create', descriptor);
      Body()(proto, 'create', 0);
      // `Location` 헤더를 붙이려면 응답 객체가 필요하다. `passthrough`이므로 반환값은
      // 그대로 Nest가 직렬화한다.
      Res({ passthrough: true })(proto, 'create', 1);
    });

    decorate(proto, 'update', (descriptor) => {
      Patch(':id')(proto, 'update', descriptor);
      Param('id')(proto, 'update', 0);
      Body()(proto, 'update', 1);
    });

    decorate(proto, 'destroy', (descriptor) => {
      Delete(':id')(proto, 'destroy', descriptor);
      HttpCode(204)(proto, 'destroy', descriptor);
      Param('id')(proto, 'destroy', 0);
    });

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
  }

  // 규칙이 없는 관계(= 쓰기 스키마에 없는 관계)는 읽기 라우트만 받는다. 읽기 전용
  // 자원은 그 규칙을 언제나 `undefined`로 만들어 관계 쓰기가 열리지 않게 한다.
  const relationshipRules = enableWrites ? (declaration.relationshipsSchema ?? {}) : {};
  for (const name of Object.keys(declaration.serializer.relationships)) {
    registerRelationship(proto, name, relationshipRules[name], writeMethods);
  }

  guardWrites(proto, writeMethods, declaration.writeGuards ?? []);
}
```

`registerRelationship`은 **고치지 않는다.** `rule`이 `undefined`면 `GET` 두 개만 만드는 분기가 이미 있고, 위에서 `relationshipRules`를 빈 객체로 만드는 것이 그 분기를 타게 하는 유일한 장치다.

- [ ] **Step 5: `CrudActions`의 조립 검사를 바꾼다**

`src/app/controllers/concerns/crud-actions.ts`의 팩토리 앞부분. `relationshipsSchema` 구조분해가 `undefined`를 받을 수 있으므로 기본값을 준다.

```ts
export function CrudActions<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
>(declaration: CrudDeclaration<T, C, U>): Type<object> {
  const { model, serializer, queryPolicy } = declaration;
  const enableWrites = declaration.enableWrites !== false;
  const relationshipsSchema = declaration.relationshipsSchema ?? {};
  const declaredRelationships = Object.keys(serializer.relationships);

  // 쓰기 라우트를 여는 자원은 그 라우트가 검증할 스키마를 함께 선언해야 한다.
  // 라우트만 열리고 검증이 비는 상태가 조용히 만들어지는 것을 막는다 —
  // `enableUpsert`/`replaceSchema`가 같은 모양의 선례다.
  if (enableWrites && declaration.createSchema === undefined) {
    throw new TypeError('enableWrites가 참이면 createSchema를 선언해야 한다');
  }
  if (enableWrites && declaration.updateSchema === undefined) {
    throw new TypeError('enableWrites가 참이면 updateSchema를 선언해야 한다');
  }

  if (declaration.enableUpsert === true && declaration.replaceSchema === undefined) {
    throw new TypeError('enableUpsert를 켰으면 replaceSchema를 선언해야 한다');
  }

  // 같은 관계를 두 곳이 선언한다. 어긋나면 라우트는 to-many로 열리는데 해석은
  // to-one으로 도는 식이 되고, 그 사고는 요청이 들어와야 드러난다.
  //
  // 시리얼라이저에 없는 이름을 쓰기 스키마가 들고 있는 반대 방향도 여기서 잡는다.
  // 그 이름은 라우트를 얻지 못하지만 `POST` 본문의 `relationships`로는 들어올 수 있고,
  // 그러면 행을 **커밋한 뒤** 응답을 되읽는 단계에서 터져 성공한 쓰기가 500으로 나간다.
  for (const [name, rule] of Object.entries(relationshipsSchema)) {
```

이어지는 루프 본문에서 `declaration.relationshipsSchema`를 참조하던 자리를 위에서 만든 `relationshipsSchema`로 바꾼다.

호스트 클래스 안에서 `declaration.createSchema`·`declaration.updateSchema`를 `parseWriteDocument`에 넘기는 자리는 이제 `| undefined`가 된다. 그 자리들은 **쓰기 액션 안에만 있고**, 쓰기 액션은 `enableWrites`가 거짓이면 라우트가 없어 도달하지 않는다. 다만 타입은 그것을 모르므로, 팩토리 위에서 좁힌 지역 상수를 만들어 클로저가 그것을 쓰게 한다.

```ts
  // 위 검사가 이미 존재를 확인했다. 지역 상수로 좁혀 두면 액션마다 `?? throw`를
  // 반복하지 않아도 되고, 좁힘의 근거가 검사 바로 아래 한 곳에 남는다.
  const createSchema = declaration.createSchema;
  const updateSchema = declaration.updateSchema;
```

그리고 액션 안에서 아래처럼 쓴다.

```ts
    async create(body: unknown, response: HeaderWritableResponse): Promise<SingleDocument> {
      if (createSchema === undefined) {
        throw new TypeError('createSchema 없이 create 라우트가 등록됐다');
      }
      const parsed = await parseWriteDocument(body, createSchema, {
        expectedType: serializer.type,
      });
```

`update`·`replace`도 같은 모양이다. 이 `throw`는 도달하지 않는 방어 코드이며, `assert`가 아니라 `throw`인 이유는 이 저장소가 조립 오류를 언제나 `TypeError`로 던지기 때문이다.

- [ ] **Step 6: 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/controllers/`

Expected: PASS. 기존 라우트 등록 테스트가 전부 그대로 통과하는 것이 중요하다 — `enableWrites`의 기본값이 참이므로 기존 자원의 동작이 하나도 바뀌지 않아야 한다.

- [ ] **Step 7: `concerns/AGENTS.md`를 갱신한다**

`src/app/controllers/concerns/AGENTS.md`의 두 자리에 더한다. 이 파일은 `test/docs/agents.spec.ts`가 일부 문구를 고정하므로 **기존 문장을 지우지 말고 덧붙인다.**

38행의 `writeMethods` 설명 뒤에 한 문장:

```markdown
`enableWrites: false`이면 `writeMethods`가 빈 배열로 시작하고 `create`·`update`·`destroy`·`replace`와 관계 mutation 라우트를 아예 등록하지 않는다 — 읽기 라우트만 남는다.
```

106-107행의 "`enableUpsert`를 켤 때" 항목 뒤에 같은 모양의 항목을 더한다:

```markdown
- **`enableWrites`를 끌 때.** `createSchema`·`updateSchema`·`relationshipsSchema`를 선언하지 않아도 된다 — 그 셋을 읽는 액션에 라우트가 없기 때문이다. 반대로 켜 둔 채(기본값) `createSchema`나 `updateSchema`를 빠뜨리면 import 시점에 죽는다.
```

- [ ] **Step 8: 전체 게이트**

Run: `pnpm exec jest --coverage=false && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint . && pnpm exec prettier --check .`

Expected: 전부 통과.

- [ ] **Step 9: 커밋**

```bash
git add src/app/controllers/concerns/ test/controllers/
git commit -m "feat: add a read-only mode to CrudActions

enableUpsert와 같은 모양의 enableWrites 옵션을 더한다. 거짓이면
create/update/destroy/replace와 관계 mutation 라우트를 등록하지 않고,
createSchema/updateSchema/relationshipsSchema를 선언하지 않아도 된다.

관계 쓰기를 막는 장치는 registerRoutes가 규칙 맵을 빈 객체로 만드는
한 줄이다 — registerRelationship의 rule undefined 분기가 이미 GET 두 개만
만든다."
```

---

### Task 6: `categories` · `tags` 읽기 라우트

**Files:**
- Create: `src/app/schemas/category.query-policy.ts`
- Create: `src/app/schemas/tag.query-policy.ts`
- Create: `src/app/controllers/api/v1/categories.controller.ts`
- Create: `src/app/controllers/api/v1/tags.controller.ts`
- Modify: `src/app/serializers/category.serializer.ts`
- Modify: `src/app/serializers/tag.serializer.ts`
- Modify: `src/app/schemas/index.ts`
- Modify: `src/config/routes.module.ts`
- Modify: `README.md`
- Modify: `src/app/controllers/concerns/AGENTS.md` (Task 5가 만든 `enableWrites` 항목에 기준 구현 포인터 추가 — Step 12)
- Create: `test/integration/reference-resources.spec.ts`
- Test: `test/config/routes.module.spec.ts`
- Test: `test/serializers/example.serializer.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `exampleCategories`·`exampleTags` 타입, Task 5의 `enableWrites`
- Produces:
  - `EXAMPLE_CATEGORY_QUERY_POLICY` · `EXAMPLE_TAG_QUERY_POLICY` (`src/app/schemas/index.ts`에서 export)
  - `CategoriesController` · `TagsController`
  - `CATEGORY_SERIALIZER.resourcePath === '/api/v1/categories'`, `TAG_SERIALIZER.resourcePath === '/api/v1/tags'`

`@Controller` 경로와 시리얼라이저 `resourcePath`가 문자 단위로 같아야 한다는 이 저장소의 불변식(`assertResourcePath`)이 양쪽 모두 `/api/v1/categories`이므로 성립한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/config/routes.module.spec.ts`의 기대 배열에 네 줄을 더한다. 배열은 정렬되어 있으므로 알파벳 위치에 맞춰 넣는다.

```ts
    expect(registeredRoutes(app)).toEqual([
      'DELETE /api/v1/examples/:id',
      'DELETE /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/categories',
      'GET /api/v1/categories/:id',
      'GET /api/v1/examples',
      'GET /api/v1/examples/:id',
      'GET /api/v1/examples/:id/category',
      'GET /api/v1/examples/:id/relationships/category',
      'GET /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples/:id/tags',
      'GET /api/v1/tags',
      'GET /api/v1/tags/:id',
      'GET /api/v1/users/me',
      'GET /health/live',
      'GET /health/ready',
      'PATCH /api/v1/examples/:id',
      'PATCH /api/v1/examples/:id/relationships/category',
      'PATCH /api/v1/examples/:id/relationships/tags',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/register',
      'POST /api/v1/examples',
      'POST /api/v1/examples/:id/relationships/tags',
      'PUT /api/v1/examples/:id',
    ]);
```

같은 파일 맨 끝에 읽기 전용임을 고정하는 테스트를 더한다.

```ts
  it('참조 자원에 쓰기 라우트가 하나도 없다', () => {
    // 등가 비교가 아니라 접두사 검사인 이유: 위 테스트가 이미 전체 집합을 등가로
    // 고정한다. 여기서 보는 것은 "이 두 경로에 GET 아닌 것이 섞이지 않았는가"다.
    const referenceRoutes = registeredRoutes(app).filter(
      (route) => route.includes('/api/v1/categories') || route.includes('/api/v1/tags'),
    );

    expect(referenceRoutes.length).toBeGreaterThan(0);
    for (const route of referenceRoutes) {
      expect(route.startsWith('GET ')).toBe(true);
    }
  });
```

`test/serializers/example.serializer.spec.ts`의 143-151행 부근, "스펙 16장에 categories·tags 단건 라우트가 없다. self 링크를 지어내면 …"이라고 적힌 테스트를 뒤집는다.

```ts
  it('참조 자원이 자기 경로를 선언한다', () => {
    // Task 6이 GET /api/v1/categories·/api/v1/tags를 열었으므로 self 링크가
    // 가리킬 URL이 실제로 있다. 두 값은 각 컨트롤러의 @Controller 경로와
    // 문자 단위로 같아야 한다 — `assertResourcePath`가 부트스트랩에서 확인한다.
    expect(CATEGORY_SERIALIZER.resourcePath).toBe('/api/v1/categories');
    expect(TAG_SERIALIZER.resourcePath).toBe('/api/v1/tags');
  });
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/config/routes.module.spec.ts test/serializers/example.serializer.spec.ts`

Expected: FAIL. 라우트 네 개가 없고 `resourcePath`가 `undefined`다.

- [ ] **Step 3: 조회 정책을 쓴다**

`src/app/schemas/category.query-policy.ts`를 만든다.

```ts
import type { QueryPolicy } from './query-policy.js';

/**
 * 분류의 조회 허용 목록.
 *
 * 기본 정렬이 `name ASC`인 것은 의도된 것이다. 선택기는 알파벳순이 맞고, Example의
 * 기본 정렬(`createdAt DESC`)과 다른 것은 참조 데이터를 최신순으로 고르지 않기
 * 때문이다.
 *
 * `includes`가 비어 있는 것도 의도된 것이다. `examples` 역참조를 열면
 * Example → category → examples → … 로 순환이 생긴다.
 *
 * **인덱스 판단 — 만들지 않는다.** 근거가 "기존 인덱스로 커버된다"가 **아니다.**
 * `name`의 UNIQUE 인덱스가 `name` 순서를 주지만, PostgreSQL은 유니크 제약을 근거로
 * 뒤따르는 정렬 키를 지우지 않으므로 `ORDER BY name, id` 계획에는 incremental sort가
 * 남는다.
 *
 * 그럼에도 `(name, id)` 인덱스를 만들지 않는 이유는 둘이다. `name`이 유니크해서 동점
 * 그룹의 크기가 항상 1이라 그 정렬 단계가 실질적으로 하는 일이 없고, 참조 테이블의
 * 행 수가 작다(분류·라벨 각각 수십 개 규모). `createdAt` 정렬은 유니크가 아니라 동점
 * 그룹 논거가 적용되지 않지만, 행 수가 작아 결론은 같다. 행 수가 크게 늘어 이 목록이
 * 주된 부하가 되면 그때 `(name, id)`를 같은 규칙으로 판단해 추가한다.
 *
 * "정렬을 여는 변경은 인덱스를 진다"는 규칙이 요구하는 것은 인덱스 자체가 아니라 이
 * 판단의 기록이다.
 */
export const EXAMPLE_CATEGORY_QUERY_POLICY: QueryPolicy = {
  filters: {
    name: { property: 'name', type: 'string', operators: ['exact', 'contains'] },
  },
  sorts: {
    name: { property: 'name', nullable: false },
    createdAt: { property: 'createdAt', nullable: false },
  },
  includes: [],
  defaultSort: [{ field: 'name', direction: 'ASC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 20,
};
```

`src/app/schemas/tag.query-policy.ts`를 만든다.

```ts
import type { QueryPolicy } from './query-policy.js';

/**
 * 라벨의 조회 허용 목록.
 *
 * 기본 정렬·`includes`·인덱스 판단의 근거는 `EXAMPLE_CATEGORY_QUERY_POLICY`와 같다.
 * `name`의 UNIQUE 인덱스가 `name` 순서를 주지만 `ORDER BY name, id`에는 incremental
 * sort가 남는다 — 그럼에도 만들지 않는 이유는 `name`이 유니크해서 동점 그룹이 항상
 * 1이고 라벨 수가 적다는 것이다. `createdAt`은 유니크가 아니라 동점 그룹 논거가
 * 적용되지 않지만 행 수가 작아 결론은 같다.
 */
export const EXAMPLE_TAG_QUERY_POLICY: QueryPolicy = {
  filters: {
    name: { property: 'name', type: 'string', operators: ['exact', 'contains'] },
  },
  sorts: {
    name: { property: 'name', nullable: false },
    createdAt: { property: 'createdAt', nullable: false },
  },
  includes: [],
  defaultSort: [{ field: 'name', direction: 'ASC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 20,
};
```

- [ ] **Step 4: 스키마 패키지에서 내보낸다**

`src/app/schemas/index.ts`의 export 목록에 두 줄을 더한다. 기존 줄의 알파벳 순서를 지킨다 — `auth.schemas.js` 다음, `example.query-policy.js` 앞이 `category.query-policy.js`의 자리다.

```ts
export { AuthCredentials, RefreshTokenInput, UserRegister } from './auth.schemas.js';
export { EXAMPLE_CATEGORY_QUERY_POLICY } from './category.query-policy.js';
export { EXAMPLE_QUERY_POLICY } from './example.query-policy.js';
export {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleReplace,
  ExampleUpdate,
} from './example.schemas.js';
export { FILTER_OPERATORS, MAX_PAGE_SIZE, isFilterOperator } from './query-policy.js';
export type {
  FilterFieldPolicy,
  FilterOperator,
  FilterValueType,
  QueryPolicy,
  SortDirection,
  SortFieldPolicy,
  SortTerm,
} from './query-policy.js';
export { EXAMPLE_TAG_QUERY_POLICY } from './tag.query-policy.js';
export { schemaProperties, validateAttributes } from './write-schema.js';
export type { RelationshipWriteRule, RelationshipWriteSchema } from './write-schema.js';
```

- [ ] **Step 5: 시리얼라이저에 `resourcePath`를 준다**

`src/app/serializers/category.serializer.ts`. `resourcePath`를 넣고, 이제 거짓이 된 docstring 문단을 고치고, **`ERASED_CATEGORY_SERIALIZER`에도 `resourcePath`를 넘긴다** — `ERASED_EXAMPLE_SERIALIZER`가 같은 모양이다. 빠뜨리면 `included[]`의 self 링크가 붙지 않는다.

```ts
/**
 * Category의 공개 표현.
 *
 * `resourcePath`는 `CategoriesController`의 `@Controller` 경로와 문자 단위로 같아야
 * 한다 — `assertResourcePath`가 부트스트랩에서 확인한다. JSON:API `type`
 * (`exampleCategories`)이 URL 경로(`/api/v1/categories`)와 다른 것은 의도된 결정이다.
 *
 * 반대편 관계(`examples`)는 선언하지 않는다. 선언하면 include 대상이 되고, 그러면
 * Category 하나가 Example 전체를 끌고 나올 수 있다.
 */
export const CATEGORY_SERIALIZER: ResourceSerializer<Category> = {
  type: 'exampleCategories',
  resourcePath: '/api/v1/categories',
  attributes: {
    name: (category) => category.name,
    createdAt: (category) => category.createdAt.toISOString(),
    updatedAt: (category) => category.updatedAt.toISOString(),
  },
  relationships: {},
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_CATEGORY_SERIALIZER: ErasedSerializer = {
  type: CATEGORY_SERIALIZER.type,
  resourcePath: CATEGORY_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Category)) {
      throw new TypeError('Category 엔티티가 아니다');
    }
    return serializeResource(CATEGORY_SERIALIZER, entity);
  },
};
```

`src/app/serializers/tag.serializer.ts`도 같은 모양이다.

```ts
/**
 * Tag의 공개 표현.
 *
 * `resourcePath`가 `TagsController`의 `@Controller` 경로와 같아야 하는 것,
 * JSON:API `type`이 URL 경로와 다른 것, 반대편 관계를 선언하지 않는 것 모두
 * `category.serializer.ts`의 주석과 같은 이유다.
 */
export const TAG_SERIALIZER: ResourceSerializer<Tag> = {
  type: 'exampleTags',
  resourcePath: '/api/v1/tags',
  attributes: {
    name: (tag) => tag.name,
    createdAt: (tag) => tag.createdAt.toISOString(),
    updatedAt: (tag) => tag.updatedAt.toISOString(),
  },
  relationships: {},
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_TAG_SERIALIZER: ErasedSerializer = {
  type: TAG_SERIALIZER.type,
  resourcePath: TAG_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Tag)) {
      throw new TypeError('Tag 엔티티가 아니다');
    }
    return serializeResource(TAG_SERIALIZER, entity);
  },
};
```

- [ ] **Step 6: 컨트롤러를 쓴다**

`src/app/controllers/api/v1/categories.controller.ts`:

```ts
import { Controller } from '@nestjs/common';
import { CrudActions } from '../../concerns/crud-actions.js';
import { Category } from '../../../models/category.entity.js';
import { EXAMPLE_CATEGORY_QUERY_POLICY } from '../../../schemas/category.query-policy.js';
import { CATEGORY_SERIALIZER } from '../../../serializers/category.serializer.js';

/**
 * 분류 자원. 읽기 전용이다.
 *
 * 분류는 서버가 관리하는 참조 데이터다. 쓰기 라우트를 열지 않으므로
 * `createSchema`·`updateSchema`·`relationshipsSchema`를 선언하지 않는다 —
 * `enableWrites: false`가 그 셋을 요구하지 않게 한다.
 *
 * 이 자원이 존재하는 이유는 관계 선택기다. 분류는 Example의 관계로만 노출되어
 * 있어서, 폼이 고를 목록을 가져올 곳이 없었다. `?include=`로 긁는 방식은
 * 불완전하다 — 어떤 Example에도 붙지 않은 분류는 영원히 나타나지 않는다.
 *
 * `@Controller` 경로가 `api/v1/categories`이고 JSON:API `type`은
 * `exampleCategories`다. 둘이 다른 것은 의도된 결정이다.
 *
 * `writeGuards`가 없다. 쓰기 라우트 자체가 없으므로 붙을 자리가 없다.
 */
@Controller('api/v1/categories')
export class CategoriesController extends CrudActions({
  model: Category,
  serializer: CATEGORY_SERIALIZER,
  queryPolicy: EXAMPLE_CATEGORY_QUERY_POLICY,
  enableWrites: false,
}) {}
```

`src/app/controllers/api/v1/tags.controller.ts`:

```ts
import { Controller } from '@nestjs/common';
import { CrudActions } from '../../concerns/crud-actions.js';
import { Tag } from '../../../models/tag.entity.js';
import { EXAMPLE_TAG_QUERY_POLICY } from '../../../schemas/tag.query-policy.js';
import { TAG_SERIALIZER } from '../../../serializers/tag.serializer.js';

/**
 * 라벨 자원. 읽기 전용이다.
 *
 * 라벨이 서버가 관리하는 참조 데이터라는 것, 쓰기 라우트를 열지 않는 이유,
 * 이 자원이 존재하는 이유는 `CategoriesController`와 같다.
 *
 * `@Controller` 경로가 `api/v1/tags`이고 JSON:API `type`은 `exampleTags`다.
 */
@Controller('api/v1/tags')
export class TagsController extends CrudActions({
  model: Tag,
  serializer: TAG_SERIALIZER,
  queryPolicy: EXAMPLE_TAG_QUERY_POLICY,
  enableWrites: false,
}) {}
```

- [ ] **Step 7: 라우트를 등록한다**

`src/config/routes.module.ts`. import 두 줄과 `controllers` 배열 두 자리를 더한다. import는 파일 경로 알파벳순이다.

```ts
import { Module } from '@nestjs/common';
import { AuthController } from '../app/controllers/api/v1/auth.controller.js';
import { CategoriesController } from '../app/controllers/api/v1/categories.controller.js';
import { ExamplesController } from '../app/controllers/api/v1/examples.controller.js';
import { TagsController } from '../app/controllers/api/v1/tags.controller.js';
import { UsersController } from '../app/controllers/api/v1/users.controller.js';
import { HealthController } from '../app/controllers/health.controller.js';
import { JwtActiveUserGuard } from '../app/auth/current-user.guard.js';
import { JWT_SETTINGS_TOKEN, TokenService } from '../app/auth/tokens.js';
import { loadJwtSettings } from './settings.js';
```

```ts
@Module({
  controllers: [
    HealthController,
    ExamplesController,
    CategoriesController,
    TagsController,
    AuthController,
    UsersController,
  ],
```

`providers` 블록과 그 위 docstring은 건드리지 않는다.

- [ ] **Step 8: 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/config/routes.module.spec.ts test/serializers/example.serializer.spec.ts`

Expected: PASS.

- [ ] **Step 9: `included[]` 스냅샷을 갱신한다**

`resourcePath`가 생겼으므로 두 자원이 `included[]`에 실릴 때 `links.self`가 붙는다. **관측 가능한 계약 변경이다.**

Run: `pnpm exec jest --coverage=false`

`included[]`를 통째로 비교하는 단언이 실패한다. 실패한 자리마다 기대값에 `links`를 더한다.

```ts
        links: { self: `/api/v1/categories/${categoryId}` },
```

```ts
        links: { self: `/api/v1/tags/${tagId}` },
```

**기대값만 고친다** — 실패를 없애려고 `resourcePath`를 되돌리지 않는다.

- [ ] **Step 10: 통합 테스트를 쓴다**

`test/integration/reference-resources.spec.ts`를 만든다. 이 파일의 앱 조립·DB fixture·요청 방식은 `test/integration/examples-api.spec.ts`가 쓰는 것을 그대로 따른다 — 새 fixture를 만들지 않는다.

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';

const JSONAPI = 'application/vnd.api+json';

interface CollectionBody {
  readonly data: readonly { readonly type: string; readonly id: string; readonly attributes: { readonly name: string } }[];
  readonly links: Readonly<Record<string, string | null>>;
}

interface SingleBody {
  readonly data: { readonly links?: Readonly<Record<string, string>> };
}

interface ErrorBody {
  readonly errors: readonly { readonly code: string }[];
}

describe('참조 자원 읽기 라우트', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    // 여기서 Category 세 개(`alpha`·`beta`·`gamma`)와 Tag 두 개(`draft-only`·`public`)를
    // 만든다. 만드는 방식은 아래 Step 10의 (1)번 지시를 따른다.
    //
    // 이름을 ASCII로 두는 이유: 정렬 기대값이 PostgreSQL의 대조 규칙에 의존하지
    // 않게 하려는 것이다. 한글 이름을 쓰면 DB locale에 따라 순서가 JS의
    // 기본 비교와 갈릴 수 있다.
  });

  afterAll(async () => {
    await app.close();
  });

  it('분류 목록이 name 오름차순이다', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(200);
    const body = response.body as CollectionBody;
    const names = body.data.map((item) => item.attributes.name);
    expect(names).toEqual([...names].sort());
    expect(body.data.every((item) => item.type === 'exampleCategories')).toBe(true);
  });

  it('라벨 목록이 name 오름차순이고 type이 exampleTags다', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tags')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(200);
    const body = response.body as CollectionBody;
    const names = body.data.map((item) => item.attributes.name);
    expect(names).toEqual([...names].sort());
    expect(body.data.every((item) => item.type === 'exampleTags')).toBe(true);
  });

  it('단건 조회가 self 링크를 낸다', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Accept', JSONAPI);
    const id = (list.body as CollectionBody).data[0]?.id;
    expect(id).toBeDefined();

    const response = await request(app.getHttpServer())
      .get(`/api/v1/categories/${String(id)}`)
      .set('Accept', JSONAPI);

    expect(response.status).toBe(200);
    expect((response.body as SingleBody).data.links?.self).toBe(`/api/v1/categories/${String(id)}`);
  });

  it('선언한 name 필터 두 연산자를 받는다', async () => {
    const exact = await request(app.getHttpServer())
      .get('/api/v1/categories?filter[name]=alpha')
      .set('Accept', JSONAPI);
    const contains = await request(app.getHttpServer())
      .get('/api/v1/categories?filter[name][contains]=lph')
      .set('Accept', JSONAPI);

    expect(exact.status).toBe(200);
    expect(contains.status).toBe(200);
    expect((contains.body as CollectionBody).data.map((item) => item.attributes.name)).toEqual(
      (exact.body as CollectionBody).data.map((item) => item.attributes.name),
    );
  });

  it('명시적 정렬이 실제로 순서를 뒤집는다', async () => {
    // 기본 정렬만 확인하면 sort= 파라미터가 무시돼도 통과한다.
    const ascending = await request(app.getHttpServer())
      .get('/api/v1/categories?sort=name')
      .set('Accept', JSONAPI);
    const descending = await request(app.getHttpServer())
      .get('/api/v1/categories?sort=-name')
      .set('Accept', JSONAPI);

    const up = (ascending.body as CollectionBody).data.map((item) => item.attributes.name);
    const down = (descending.body as CollectionBody).data.map((item) => item.attributes.name);
    expect(up.length).toBeGreaterThan(1);
    expect(down).toEqual([...up].reverse());
  });

  it('커서로 컬렉션을 끝까지 걷는다', async () => {
    const seen: string[] = [];
    let url: string | null = '/api/v1/categories?page[size]=1&page[after]=';
    while (url !== null) {
      const response = await request(app.getHttpServer()).get(url).set('Accept', JSONAPI);
      const body = response.body as CollectionBody;
      seen.push(...body.data.map((item) => item.attributes.name));
      url = body.links.next ?? null;
    }

    const all = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Accept', JSONAPI);
    expect(seen).toEqual((all.body as CollectionBody).data.map((item) => item.attributes.name));
  });

  it('선언하지 않은 필터 연산자를 INVALID_FILTER로 거절한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/categories?filter[name][gt]=a')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_FILTER');
  });

  it('선언하지 않은 include를 INVALID_INCLUDE로 거절한다', async () => {
    // includes가 비어 있다. examples 역참조를 열면 순환이 생긴다.
    const response = await request(app.getHttpServer())
      .get('/api/v1/categories?include=examples')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_INCLUDE');
  });

  it('분류 컬렉션이 쓰기를 받지 않는다', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Accept', JSONAPI)
      .set('Content-Type', JSONAPI)
      .send(JSON.stringify({ data: { type: 'exampleCategories', attributes: { name: 'delta' } } }));

    expect(response.status).toBe(405);
  });

  it('라벨 단건이 삭제를 받지 않는다', async () => {
    const response = await request(app.getHttpServer())
      .delete('/api/v1/tags/00000000-0000-0000-0000-000000000000')
      .set('Accept', JSONAPI);

    expect(response.status).toBe(405);
  });
});
```

**두 가지를 실제 파일에 맞춰 고친다.**

1. `beforeAll`의 데이터 준비. 위 코드는 그 자리를 주석으로만 표시해 두었다 — `test/integration/examples-api.spec.ts`를 먼저 읽고, 그 파일이 Category·Tag를 만드는 방식과 **같은 fixture·같은 격리 방식**을 쓴다. 새 fixture를 만들지 않는다. 이름은 `alpha`·`beta`·`gamma`(분류)와 `draft-only`·`public`(라벨)로 ASCII로 둔다. 분류가 3개 이상이어야 커서 순회(`page[size]=1`)와 정렬 뒤집기 테스트가 실제로 무언가를 확인한다.

2. 405 기대값. Nest가 등록되지 않은 메서드에 무엇을 돌려주는지 이 저장소의 설정에 따라 404일 수 있다. **먼저 실행해 실제 값을 보고 그 값으로 고정한다.** 405든 404든 상관없지만, 기대값과 실제가 같아야 하고 그 값이 무엇인지 보고에 적는다. 정본은 405를 낸다.

- [ ] **Step 11: 통합 테스트가 통과하는 것을 확인한다**

Run: `pnpm exec jest --coverage=false test/integration/reference-resources.spec.ts`

Expected: PASS.

> 이 태스크는 Step 3~7이 이미 만든 라우트를 **검증**하는 것이라 이 파일에 red 단계가 없는 것이 정상이다. 실패가 나오면 그것은 이 테스트의 red가 아니라 앞 단계의 버그다.

- [ ] **Step 12: README에 새 라우트를 문서화한다**

`README.md`의 공개 API 표면을 설명하는 표 뒤에 절을 더한다. 삽입 위치는 Example 라우트를 나열하는 표 바로 다음이다.

아래 블록의 **바깥 울타리(````)는 이 계획 문서의 것이다.** README에 넣는 것은 그 안의 내용뿐이고, 안쪽의 ```bash 울타리는 README에 그대로 들어간다.

````markdown
## 참조 자원

분류와 라벨은 읽기 전용 컬렉션으로도 조회할 수 있습니다. 관계 선택기처럼 고를 목록이
필요한 화면을 위한 것이며, 쓰기 라우트는 없습니다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| `GET` | `/api/v1/categories` | 분류 목록 (`filter[name]` · `sort=name,createdAt` · `page[...]`) |
| `GET` | `/api/v1/categories/{id}` | 분류 단건 |
| `GET` | `/api/v1/tags` | 라벨 목록 |
| `GET` | `/api/v1/tags/{id}` | 라벨 단건 |

기본 정렬은 `name` 오름차순입니다. JSON:API 자원 타입은 각각 `exampleCategories`와
`exampleTags`로, URL 경로와 다릅니다. 읽기는 Example과 마찬가지로 공개이며 `include`는
지원하지 않습니다.

```bash
curl --globoff -fsS \
  -H 'Accept: application/vnd.api+json' \
  'http://localhost:3000/api/v1/categories?filter[name][contains]=문서'
```
````

`README.md:271` 부근의 "새 리소스 추가" 절, `enableUpsert`/`replaceSchema`를 설명하는 항목 뒤에 `enableWrites` 항목을 더한다.

```markdown
   - **`enableWrites`** — 읽기 전용 자원은 `enableWrites: false`를 선언합니다. `POST`/`PATCH`/`DELETE`와 관계 변경 라우트가 아예 등록되지 않고, `createSchema`·`updateSchema`·`relationshipsSchema`를 선언하지 않아도 됩니다. 기준 구현은 `src/app/controllers/api/v1/categories.controller.ts`입니다.
```

`test/docs/readme.spec.ts`가 README의 일부 문구를 고정한다. **기존 문장을 지우지 말고 덧붙인다.** 실패하면 무엇이 고정되어 있는지 읽고 그 고정과 충돌하지 않는 표현으로 바꾼다 — 고정 테스트를 지우지 않는다.

마지막으로 `src/app/controllers/concerns/AGENTS.md`의 `enableWrites` 항목(Task 5가 만든 것)에 기준 구현 포인터를 붙인다. Task 5 시점에는 그 파일이 아직 없어 죽은 참조가 되므로 여기서 붙인다.

```markdown
읽기 전용 자원의 기준 구현은 `src/app/controllers/api/v1/categories.controller.ts`다.
```

- [ ] **Step 13: 전체 게이트**

Run: `pnpm check`

Expected: 전부 통과. 이 스크립트가 일회용 PostgreSQL과 Redis를 띄우므로 bash와 Docker가 필요하다.

- [ ] **Step 14: 커밋**

```bash
git add src/app/schemas/ src/app/serializers/category.serializer.ts src/app/serializers/tag.serializer.ts src/app/controllers/api/v1/ src/config/routes.module.ts README.md test/
git commit -m "feat: add read-only categories and tags routes

GET /api/v1/categories와 GET /api/v1/tags를 연다. 분류와 라벨이 Example의
관계로만 노출되어 있어서 폼의 관계 선택기가 고를 목록을 가져올 곳이 없었다.

정렬 기본값은 name ASC다. 참조 데이터는 최신순으로 고르지 않는다.

두 시리얼라이저에 resourcePath를 준다. included[]에 실릴 때 links.self가
붙으므로 기존 응답이 바뀐다 — 기대값을 같은 변경에서 갱신한다.

새 인덱스는 만들지 않는다. name의 UNIQUE 인덱스가 name 순서를 주지만
ORDER BY name, id를 완전히 커버하지는 않는다 — PostgreSQL은 유니크 제약을
근거로 뒤따르는 정렬 키를 지우지 않는다. 그래도 만들지 않는 이유는 동점
그룹이 항상 1이고 참조 테이블의 행 수가 작기 때문이며, 그 판단을 정책
선언부 주석에 남겼다."
```

---

## 완료 조건

`pnpm check`가 통과하고, 아래가 모두 참이다.

- `GET /api/v1/examples?include=category,tags`의 `included[].type`이 `exampleCategories` · `exampleTags`다.
- 그 응답의 linkage를 그대로 되돌려보내는 관계 쓰기 요청이 성공한다.
- Example 응답의 attributes가 `title` · `description` · `status` · `score` · `createdAt` · `updatedAt`이다.
- `status` 값이 `draft` / `active` / `archived`다.
- `score` 범위 위반이 422다. `status` 없는 생성이 422다.
- 새 filter와 sort가 전부 2xx이고, `filter[publishedAt]` · `sort=publishedAt` · `sort=id`가 400이다.
- `page[size]` 없는 목록이 20건이다.
- 마이그레이션 드리프트 검사가 통과한다(엔티티 ↔ 실제 스키마).
- nullable 정렬 커서 거부가 합성 정책으로 검증된다.
- `GET /api/v1/categories`와 `GET /api/v1/tags`가 `name` 오름차순 목록을 낸다.
- 두 경로의 쓰기 메서드에 라우트가 없다.
- `GET /api/v1/examples?include=category,tags`의 `included[]`에 `links.self`가 있다.
- `ExamplesController`의 쓰기 라우트가 그대로 남아 있다.

**마지막 검증은 정본과의 응답 대조다.** 두 백엔드를 같은 데이터로 띄우고 같은 요청을 보내 문서가 같은지 본다. 그것이 이 계획의 진짜 완료 조건이며, 위 항목들은 그 대조가 실패했을 때 어디를 볼지 좁히기 위한 것이다.

## 이 계획이 다루지 않는 것

스펙 §11의 마지막 리스크는 "정본과의 대조가 수작업이 된다 → Rails 스펙과 같은 대조 스크립트를 공유한다"이다. **그 스크립트를 이 계획에서 만들지 않는다.**

세 백엔드가 공유하는 도구이고, Rails(C)가 아직 통일 전이라 지금 만들면 대조 상대가 둘뿐인 스크립트가 된다. 세 저장소 중 하나에 두는 것도, 어디에 둘지도 이 계획이 혼자 정할 문제가 아니다. 위 완료 조건의 마지막 항목은 그때까지 수작업 대조로 남는다 — 세 백엔드가 모두 통일된 뒤 별도 작업으로 만든다.

Next.js 스펙 10.4의 3-백엔드 매트릭스 E2E가 결국 이 대조를 자동화하는 자리이므로, 그 작업과 합치는 것이 자연스럽다.
