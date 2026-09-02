# Phase 4: 선언형 CRUD (`CrudActions`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 컨트롤러에 모델·시리얼라이저·쓰기 스키마·조회 정책의 **선언만** 두면 index/show/create/update/destroy와 관계 라우트가 생기는 `CrudActions` mixin을 만든다.

**Architecture:** 팩토리가 베이스 클래스를 만들고 그 프로토타입에 액션을 정의한 뒤 Nest 데코레이터를 **함수로** 적용한다. 정적 액션은 고정 경로이고, 관계 라우트는 시리얼라이저의 `relationships` 키와 관계 스키마 필드의 교집합만큼 동적으로 생긴다. 책임은 스펙 6.2가 정한 7개 concern 파일로 나누고 상속 체인은 언제나 아래 방향으로만 참조한다.

**Tech Stack:** TypeScript 6.0.3(ESM, `strict` + `noUncheckedIndexedAccess`), NestJS 12, TypeORM 1.1.0, class-validator 0.15 + class-transformer 0.5, PostgreSQL 18, Jest 30

**Spec:** `docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md` (6장 CrudActions 설계, 7.1·7.3 쓰기 계약, 5.3 응답, 16장 공개 API 표면)

## 사전 검증 결과 (계획 작성 중 실측)

팩토리가 동적으로 만든 클래스에는 `emitDecoratorMetadata`가 `design:paramtypes`를 붙여 주지 않는다. 스펙 6.4의 "요청 스코프 DataSource 주입"이 이 위에 서 있으므로 폐기용 프로브로 확인했다.

- `Inject(TOKEN)(HostClass, undefined, 0)`으로 생성자 파라미터에 주입을 **프로그래매틱으로** 선언하면 Nest가 해석한다.
- 같은 클래스의 프로토타입 메서드에 `Get(':id')(proto, 'show', descriptor)`와 `Param('id')(proto, 'show', 0)`을 적용하면 라우트와 파라미터 바인딩이 모두 동작한다.
- 그 베이스를 `@Controller('probe')`로 서브클래싱한 컨트롤러에서 실제 HTTP 요청이 200과 기대 본문을 돌려주는 것까지 확인했다.

즉 이 계획의 조립 방식은 검증된 것이며, `design:paramtypes`가 없어서 실패하지 않는다.

## Global Constraints

- 모든 상대 import에 `.js` 확장자를 붙인다. 빠뜨리면 `tsc`가 `TS2835`로 거부한다.
- `noUncheckedIndexedAccess`가 켜져 있다. `arr[0]`과 `record[key]`는 `T | undefined`다. `!`나 `as`로 지우지 말고 실제 분기로 좁힌다.
- 컴파일러를 침묵시키는 `as` 캐스트를 쓰지 않는다. 좁혀야 하면 타입 프레디케이트나 `instanceof` 분기를 쓴다.
- ESLint는 `strictTypeChecked` + `stylisticTypeChecked`다. `any`가 흘러나오는 표현은 전부 오류다.
- 함수 선언에는 명시적 반환 타입을 붙인다(`allowExpressions: true`이므로 콜백은 예외). **변수에 대입하는 화살표 함수도 반환 타입이 필요하다** — 면제되는 것은 인자로 넘기는 콜백뿐이다.
- 오류는 `JsonApiError`(사용자 입력)와 `TypeError`(프로그래밍 오류)만 던진다. 코드는 `src/app/jsonapi/errors.ts`의 24개 카탈로그에서 고르고 새 코드를 늘리지 않는다.
- 자원별 service를 만들지 않는다. 컨트롤러가 `CrudActions`를 통해 ORM과 직접 대화한다(스펙 4장).
- 라우트 자동 탐색을 넣지 않는다. `RoutesModule`의 배열에 없는 컨트롤러는 존재하지 않는 것과 같다.
- 주석과 테스트 이름은 한국어로 쓴다. 기존 파일(`src/app/jsonapi/*.ts`)의 밀도와 어조를 따른다 — 주석은 **왜**를 적는다.
- 커밋 메시지에 AI 첨부 트레일러를 넣지 않는다.
- 모든 단계가 끝나면 `./scripts/check.sh`가 통과해야 한다(커버리지 게이트 80%).

---

## 이 계획이 만드는 파일

| 경로 | 책임 |
| --- | --- |
| `src/app/jsonapi/errors.ts` (수정) | `JsonApiErrors` 집합 오류 추가 |
| `src/app/jsonapi/exception-filter.ts` (수정) | 집합 오류를 여러 오류 객체로 펼침 |
| `src/app/schemas/write-schema.ts` | 쓰기 DTO 검증 실행기 |
| `src/app/schemas/example.schemas.ts` | Example의 create/update/replace/relationships 스키마 |
| `src/app/controllers/concerns/crud-base.ts` | 선언 계약과 훅 |
| `src/app/controllers/concerns/document-parsing.ts` | 요청 문서 파싱·검증, `presentKeys` 캡처 |
| `src/app/controllers/concerns/jsonapi-controller.ts` | prefix 검증과 협상 정책 |
| `src/app/controllers/concerns/relationship-resolver.ts` | linkage 해석과 관계 액션 |
| `src/app/controllers/concerns/route-registrar.ts` | 라우트·응답 코드·가드 등록 |
| `src/app/controllers/concerns/crud-actions.ts` | 조립과 다섯 액션 |
| `src/app/controllers/api/v1/examples.controller.ts` | Example 자원 선언 |
| `src/config/routes.module.ts` (수정) | 컨트롤러 명시 등록 |
| `test/app-factory.ts` (수정) | body parser·query parser 고정 |

`PUT` upsert(`upsert-executor.ts`)는 Phase 5의 계획이 맡는다. 이 계획의 `enableUpsert`는 선언만 받아 두고 라우트를 만들지 않는다.

---

### Task 1: 여러 검증 오류를 한 문서로 내보내기

**Files:**
- Modify: `src/app/jsonapi/errors.ts`
- Modify: `src/app/jsonapi/exception-filter.ts`
- Test: `test/jsonapi/errors.spec.ts`, `test/jsonapi/exception-filter.spec.ts`

**Interfaces:**
- Produces: `class JsonApiErrors extends Error { readonly errors: readonly JsonApiError[] }`

**왜 필요한가:** 쓰기 스키마 검증은 한 요청에서 필드 여러 개가 동시에 틀릴 수 있다. 첫 오류만 돌려주면 클라이언트가 고칠 때마다 왕복해야 한다. `buildErrorDocument`는 이미 배열을 받고 그 계약을 고정하는 테스트도 있는데, 필터가 언제나 하나만 넘기고 있어 그 능력이 닿지 않는다. 필터가 집합 오류를 펼치게 해서 잇는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/errors.spec.ts` 끝에 더한다(파일 위쪽 import에 `JsonApiErrors`를 추가한다).

```ts
describe('JsonApiErrors', () => {
  it('여러 오류를 담는다', () => {
    const aggregate = new JsonApiErrors([
      new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/a' } }),
      new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/b' } }),
    ]);
    expect(aggregate.errors).toHaveLength(2);
  });

  it('Error를 상속한다', () => {
    // 예외 필터가 `instanceof`로 갈라내고, 잡히지 않았을 때 스택이 남아야 한다.
    expect(new JsonApiErrors([new JsonApiError('VALIDATION_ERROR')])).toBeInstanceOf(Error);
  });

  it('비어 있는 목록을 거부한다', () => {
    // 오류가 없는 오류는 없다. 빈 문서(`{"errors": []}`)가 나가면 클라이언트는
    // 무엇이 잘못됐는지 알 수 없고 성공으로 오해할 수도 있다.
    expect(() => new JsonApiErrors([])).toThrow(TypeError);
  });

  it('첫 오류의 status를 대표 status로 쓴다', () => {
    const aggregate = new JsonApiErrors([
      new JsonApiError('VALIDATION_ERROR'),
      new JsonApiError('VALIDATION_ERROR'),
    ]);
    expect(aggregate.status).toBe(422);
  });
});
```

`test/jsonapi/exception-filter.spec.ts`의 `describe('JsonApiExceptionFilter', ...)` 안에 더한다(파일 위쪽 import에 `JsonApiErrors`를 추가한다).

```ts
  it('집합 오류를 여러 오류 객체로 펼친다', () => {
    const { host, captured } = hostFor();
    filter.catch(
      new JsonApiErrors([
        new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/title' } }),
        new JsonApiError('VALIDATION_ERROR', { source: { pointer: '/data/attributes/status' } }),
      ]),
      host,
    );
    expect(captured.status).toBe(422);
    const body = captured.body as { errors: { source: { pointer: string } }[] };
    expect(body.errors.map((error) => error.source.pointer)).toEqual([
      '/data/attributes/title',
      '/data/attributes/status',
    ]);
  });

  it('집합 오류도 로그에 남기지 않는다', () => {
    // `JsonApiError`와 같은 이유다 — 카탈로그에 있는 의도된 결과이므로
    // 헬스체크나 검증 실패가 로그를 채우지 않는다.
    const { host } = hostFor();
    filter.catch(new JsonApiErrors([new JsonApiError('VALIDATION_ERROR')]), host);
    expect(logged).toHaveLength(0);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/errors.spec.ts test/jsonapi/exception-filter.spec.ts`
Expected: FAIL — `JsonApiErrors is not exported`

- [ ] **Step 3: 집합 오류를 만든다**

`src/app/jsonapi/errors.ts` 끝에 더한다.

```ts
/**
 * 한 요청에서 동시에 발생한 여러 오류.
 *
 * 쓰기 스키마 검증은 필드 여러 개가 한꺼번에 틀릴 수 있다. 첫 오류만 돌려주면
 * 클라이언트가 하나씩 고치며 왕복해야 하므로, 한 번에 모두 알려 준다.
 *
 * `status`는 첫 오류의 것을 쓴다. JSON:API는 여러 오류의 status가 갈릴 때 상위
 * 자릿수로 뭉개라고 권하지만, 이 템플릿에서 집합으로 나가는 것은 같은 코드의
 * 검증 오류뿐이라 그 규칙이 쓰일 자리가 없다 — 갈리는 집합을 만들게 되면 그때
 * 뭉개는 규칙을 여기 넣는다.
 */
export class JsonApiErrors extends Error {
  readonly errors: readonly JsonApiError[];
  readonly status: number;

  constructor(errors: readonly JsonApiError[]) {
    const [first] = errors;
    if (first === undefined) {
      throw new TypeError('JsonApiErrors는 오류를 하나 이상 담아야 한다');
    }
    super(first.message);
    this.name = 'JsonApiErrors';
    this.errors = errors;
    this.status = first.status;
  }
}
```

- [ ] **Step 4: 필터가 펼치게 한다**

`src/app/jsonapi/exception-filter.ts`를 고친다.

import에 `JsonApiErrors`를 더한다.

```ts
import { ERROR_CATALOG, JsonApiError, JsonApiErrors } from './errors.js';
```

`normalize`를 아래로 교체한다.

```ts
/** 던져진 값을 오류 객체 목록으로 정규화한다. */
function normalize(exception: unknown): readonly JsonApiError[] {
  if (exception instanceof JsonApiErrors) {
    return exception.errors;
  }
  if (exception instanceof JsonApiError) {
    return [exception];
  }
  if (exception instanceof HttpException) {
    return [new JsonApiError('HTTP_ERROR', { status: exception.getStatus() })];
  }
  return [new JsonApiError('INTERNAL_SERVER_ERROR')];
}
```

`shouldLog`의 첫 분기를 집합 오류까지 덮도록 고친다.

```ts
function shouldLog(exception: unknown, status: number): boolean {
  if (exception instanceof JsonApiError || exception instanceof JsonApiErrors) {
    return false;
  }
  if (exception instanceof HttpException) {
    return status >= 500;
  }
  return true;
}
```

`catch`의 본문에서 오류를 목록으로 다루도록 고친다.

```ts
    const errors = normalize(exception);
    const [first] = errors;
    if (first === undefined) {
      throw new TypeError('정규화 결과가 비어 있다');
    }

    if (shouldLog(exception, first.status)) {
      this.logger.error(
        `${request.method} ${request.url} -> ${first.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    pinJsonApiContentType(response);
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
    response.status(first.status).json(buildErrorDocument(errors, language));
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi`
Expected: PASS

- [ ] **Step 6: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`

- [ ] **Step 7: 커밋한다**

```bash
git add src/app/jsonapi/errors.ts src/app/jsonapi/exception-filter.ts test/jsonapi/errors.spec.ts test/jsonapi/exception-filter.spec.ts
git commit -m "feat(jsonapi): 여러 검증 오류를 한 문서로 내보내는 집합 오류 추가"
```

---
### Task 2: 쓰기 스키마 검증기와 Example 스키마

**Files:**
- Create: `src/app/schemas/write-schema.ts`
- Create: `src/app/schemas/example.schemas.ts`
- Modify: `src/app/schemas/index.ts` (재export)
- Test: `test/schemas/write-schema.spec.ts`, `test/schemas/example.schemas.spec.ts`

**Interfaces:**
- Consumes: `JsonApiError`, `JsonApiErrors` (Task 1); `EXAMPLE_STATUSES` (`src/app/models/example.entity.ts`)
- Produces:
  - `function validateAttributes<D extends object>(schema: ClassConstructor<D>, attributes: Record<string, unknown>): Promise<D>`
  - `type RelationshipCardinality = 'one' | 'many'` (재사용: `src/app/serializers/serializer.ts`에서 import)
  - `interface RelationshipWriteRule { cardinality: RelationshipCardinality; type: string; model: EntityTarget<ObjectLiteral> }`
  - `type RelationshipWriteSchema = Readonly<Record<string, RelationshipWriteRule>>`
  - `class ExampleCreate`, `class ExampleUpdate`, `class ExampleReplace`
  - `const EXAMPLE_RELATIONSHIPS: RelationshipWriteSchema`

**스펙과의 의도적 차이 — `relationshipsSchema`를 클래스가 아니라 선언 객체로 둔다.**

스펙 6.1의 예시는 `relationshipsSchema: ExampleRelationships`라는 클래스를 보여 준다. 클래스로 두면 두 가지가 곤란하다. 첫째, 6.3이 요구하는 "시리얼라이저 관계 키와 **관계 스키마 필드**의 교집합"을 얻으려면 필드 이름을 런타임에 읽어야 하는데, TypeScript 클래스의 선언 필드는 초기값이 없으면 인스턴스에 존재하지 않아 `Object.keys`로 잡히지 않는다. 둘째, linkage를 실제 자원으로 해석하려면 **대상 엔티티**를 알아야 하는데 검증용 클래스는 그것을 들고 있을 자리가 없다.

선언 객체는 두 문제를 함께 푼다 — 키가 곧 필드 목록이고, 값이 cardinality·JSON:API type·대상 모델을 함께 들고 있다. 옵션 이름(`relationshipsSchema`)은 스펙 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/schemas/write-schema.spec.ts`:

```ts
import { IsInt, IsOptional, IsString, Length } from 'class-validator';
import { JsonApiError, JsonApiErrors } from '../../src/app/jsonapi/errors.js';
import { validateAttributes } from '../../src/app/schemas/write-schema.js';

class Sample {
  @IsString()
  @Length(1, 10)
  title!: string;

  @IsOptional()
  @IsInt()
  size?: number;
}

/** 집합 오류가 아니면 다시 던져 테스트를 실패시킨다. */
async function caught(run: () => Promise<unknown>): Promise<JsonApiErrors> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof JsonApiErrors)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('validateAttributes', () => {
  it('유효한 값을 스키마 인스턴스로 돌려준다', async () => {
    const result = await validateAttributes(Sample, { title: '제목', size: 3 });
    expect(result).toBeInstanceOf(Sample);
    expect(result.title).toBe('제목');
    expect(result.size).toBe(3);
  });

  it('선택 필드를 생략해도 통과한다', async () => {
    expect((await validateAttributes(Sample, { title: '제목' })).size).toBeUndefined();
  });

  it('검증 실패를 VALIDATION_ERROR로 낸다', async () => {
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    expect(aggregate.errors).toHaveLength(1);
    expect(aggregate.errors[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('실패한 필드를 pointer로 가리킨다', async () => {
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    expect(aggregate.errors[0]?.source).toEqual({ pointer: '/data/attributes/title' });
  });

  it('여러 필드가 틀리면 모두 담는다', async () => {
    // 하나씩 알려 주면 클라이언트가 고칠 때마다 왕복해야 한다.
    const aggregate = await caught(() => validateAttributes(Sample, { title: '', size: 'x' }));
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors.map((error) => error.source?.pointer).sort()).toEqual([
      '/data/attributes/size',
      '/data/attributes/title',
    ]);
  });

  it('선언되지 않은 필드를 거부한다', async () => {
    // `forbidNonWhitelisted`가 Pydantic의 `extra="forbid"`에 해당한다. 조용히 버리면
    // 오타 난 필드가 무시된 채 저장되고, 클라이언트는 반영됐다고 읽는다.
    const aggregate = await caught(() => validateAttributes(Sample, { title: '제목', extra: 1 }));
    expect(aggregate.errors[0]?.source).toEqual({ pointer: '/data/attributes/extra' });
  });

  it('detail에 실패 이유를 담는다', async () => {
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    expect(aggregate.errors[0]?.detail).toEqual(expect.stringContaining('title'));
  });

  it('던지는 것은 언제나 JsonApiErrors다', async () => {
    // 하나만 틀렸을 때도 집합으로 던져야 잡는 쪽이 분기하지 않는다.
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    expect(aggregate).toBeInstanceOf(JsonApiErrors);
    expect(aggregate.errors[0]).toBeInstanceOf(JsonApiError);
  });
});
```

`test/schemas/example.schemas.spec.ts`:

```ts
import { EXAMPLE_STATUSES } from '../../src/app/models/example.entity.js';
import { JsonApiErrors } from '../../src/app/jsonapi/errors.js';
import {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleReplace,
  ExampleUpdate,
} from '../../src/app/schemas/example.schemas.js';
import { validateAttributes } from '../../src/app/schemas/write-schema.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';

async function caught(run: () => Promise<unknown>): Promise<JsonApiErrors> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof JsonApiErrors)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('ExampleCreate', () => {
  it('제목만으로 만들 수 있다', async () => {
    const dto = await validateAttributes(ExampleCreate, { title: '제목' });
    expect(dto.title).toBe('제목');
  });

  it('제목이 없으면 거부한다', async () => {
    expect((await caught(() => validateAttributes(ExampleCreate, {}))).errors[0]?.source).toEqual({
      pointer: '/data/attributes/title',
    });
  });

  it('제목 길이 상한이 엔티티 컬럼과 같다', async () => {
    // 스키마가 더 느슨하면 DB가 거절하고 500이 나간다.
    await expect(
      validateAttributes(ExampleCreate, { title: 'ㄱ'.repeat(200) }),
    ).resolves.toBeInstanceOf(ExampleCreate);
    await expect(validateAttributes(ExampleCreate, { title: 'ㄱ'.repeat(201) })).rejects.toThrow(
      JsonApiErrors,
    );
  });

  it('status는 엔티티의 enum 값만 받는다', async () => {
    for (const status of EXAMPLE_STATUSES) {
      await expect(
        validateAttributes(ExampleCreate, { title: '제목', status }),
      ).resolves.toBeInstanceOf(ExampleCreate);
    }
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', status: 'unknown' }),
    ).rejects.toThrow(JsonApiErrors);
  });

  it('publishedAt을 Date로 바꾼다', async () => {
    // 저장 계층은 Date를 받는다. 문자열을 그대로 넘기면 TypeORM이 조용히
    // 문자열을 저장하려다 드라이버 단계에서 터진다.
    const dto = await validateAttributes(ExampleCreate, {
      title: '제목',
      publishedAt: '2026-08-30T00:00:00.000Z',
    });
    expect(dto.publishedAt).toBeInstanceOf(Date);
  });

  it('publishedAt이 날짜가 아니면 거부한다', async () => {
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', publishedAt: '어제' }),
    ).rejects.toThrow(JsonApiErrors);
  });

  it('publishedAt에 null을 허용한다', async () => {
    const dto = await validateAttributes(ExampleCreate, { title: '제목', publishedAt: null });
    expect(dto.publishedAt).toBeNull();
  });

  it('내부 FK를 입력으로 받지 않는다', async () => {
    // 스펙 7.3: 내부 FK를 공개 입력으로 만들지 않는다. 관계는 relationships로만 바꾼다.
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', categoryId: 'x' }),
    ).rejects.toThrow(JsonApiErrors);
  });
});

describe('ExampleUpdate', () => {
  it('모든 필드가 선택이다', async () => {
    // PATCH는 보낸 필드만 바꾼다. 필수 필드를 두면 부분 갱신이 불가능해진다.
    await expect(validateAttributes(ExampleUpdate, {})).resolves.toBeInstanceOf(ExampleUpdate);
  });

  it('보낸 필드는 여전히 검증한다', async () => {
    await expect(validateAttributes(ExampleUpdate, { title: '' })).rejects.toThrow(JsonApiErrors);
  });
});

describe('ExampleReplace', () => {
  it('생성과 같은 필수 조건을 건다', async () => {
    // PUT은 전체 교체이므로 보내지 않은 필드는 기본값으로 돌아간다.
    await expect(validateAttributes(ExampleReplace, {})).rejects.toThrow(JsonApiErrors);
    await expect(validateAttributes(ExampleReplace, { title: '제목' })).resolves.toBeInstanceOf(
      ExampleReplace,
    );
  });
});

describe('EXAMPLE_RELATIONSHIPS', () => {
  it('쓸 수 있는 관계를 선언한다', () => {
    expect(Object.keys(EXAMPLE_RELATIONSHIPS).sort()).toEqual(['category', 'tags']);
  });

  it('cardinality가 시리얼라이저 선언과 일치한다', () => {
    // 두 선언이 갈리면 to-one 관계에 배열 라우트가 생기거나 그 반대가 된다.
    for (const [name, rule] of Object.entries(EXAMPLE_RELATIONSHIPS)) {
      expect(rule.cardinality).toBe(EXAMPLE_SERIALIZER.relationships[name]?.cardinality);
    }
  });

  it('JSON:API type이 대상 시리얼라이저와 일치한다', () => {
    for (const [name, rule] of Object.entries(EXAMPLE_RELATIONSHIPS)) {
      expect(rule.type).toBe(EXAMPLE_SERIALIZER.relationships[name]?.target().type);
    }
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/schemas`
Expected: FAIL — `Cannot find module '../../src/app/schemas/write-schema.js'`

- [ ] **Step 3: 검증기를 만든다**

`src/app/schemas/write-schema.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import type { ValidationError } from 'class-validator';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { JsonApiError, JsonApiErrors } from '../jsonapi/errors.js';
import type { RelationshipCardinality } from '../serializers/serializer.js';

/**
 * 쓰기 DTO 검증.
 *
 * 참조 구현의 Pydantic `extra="forbid"`에 해당하는 것이 `forbidNonWhitelisted`다.
 * 선언되지 않은 필드를 조용히 버리면 오타 난 필드가 무시된 채 저장되고 클라이언트는
 * 반영됐다고 읽는다 — 그 조용한 실패를 거부로 바꾼다.
 *
 * 실패는 언제나 `JsonApiErrors`로 던진다. 하나만 틀렸을 때도 집합으로 던져야
 * 잡는 쪽이 "하나인가 여럿인가"로 분기하지 않는다.
 */

/** `ValidationError` 하나를 JSON:API 오류로 옮긴다. */
function toJsonApiError(failure: ValidationError): JsonApiError {
  const constraints = failure.constraints ?? {};
  const messages = Object.values(constraints);
  const [detail] = messages;
  return new JsonApiError('VALIDATION_ERROR', {
    source: { pointer: `/data/attributes/${failure.property}` },
    // 제약이 여러 개 걸린 필드는 첫 메시지만 싣는다. 나머지는 같은 필드를 고치면
    // 함께 사라지므로, 한 필드에 여러 줄을 내는 것보다 필드당 한 줄이 읽기 쉽다.
    detail: detail ?? `"${failure.property}" is invalid`,
  });
}

/** 중첩 검증 오류를 평평하게 편다. */
function flatten(failures: readonly ValidationError[]): JsonApiError[] {
  const errors: JsonApiError[] = [];
  for (const failure of failures) {
    if (failure.constraints !== undefined) {
      errors.push(toJsonApiError(failure));
    }
    if (failure.children !== undefined && failure.children.length > 0) {
      errors.push(...flatten(failure.children));
    }
  }
  return errors;
}

/**
 * attributes를 쓰기 스키마로 검증하고 인스턴스를 돌려준다.
 *
 * `plainToInstance`가 `@Transform`을 먼저 적용하므로, 저장 형식으로의 변환
 * (ISO 문자열 → `Date` 등)은 검증 이전에 끝나 있다.
 */
export async function validateAttributes<D extends object>(
  schema: ClassConstructor<D>,
  attributes: Record<string, unknown>,
): Promise<D> {
  const instance = plainToInstance(schema, attributes);
  const failures = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  const errors = flatten(failures);
  if (errors.length > 0) {
    throw new JsonApiErrors(errors);
  }
  return instance;
}

/** 쓸 수 있는 관계 하나의 선언. */
export interface RelationshipWriteRule {
  readonly cardinality: RelationshipCardinality;
  /** 이 관계가 받는 자원의 JSON:API type. linkage의 type과 대조한다. */
  readonly type: string;
  /** linkage의 id로 실제 행을 찾을 때 쓰는 엔티티. */
  readonly model: EntityTarget<ObjectLiteral>;
}

/**
 * 자원이 쓰기로 여는 관계 목록.
 *
 * 스펙 6.3의 "시리얼라이저 관계 키와 관계 스키마 필드의 교집합"에서 뒤쪽이 이것이다.
 * 여기 없는 관계는 읽기 전용이 되고 mutation 라우트가 생기지 않는다.
 */
export type RelationshipWriteSchema = Readonly<Record<string, RelationshipWriteRule>>;
```

- [ ] **Step 4: Example 스키마를 만든다**

`src/app/schemas/example.schemas.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Category } from '../models/category.entity.js';
import { EXAMPLE_STATUSES } from '../models/example.entity.js';
import type { ExampleStatus } from '../models/example.entity.js';
import { Tag } from '../models/tag.entity.js';
import type { RelationshipWriteSchema } from './write-schema.js';

/**
 * Example의 쓰기 계약.
 *
 * `categoryId`는 어느 스키마에도 없다. 내부 FK를 공개 입력으로 만들지 않는다는
 * 스펙 7.3의 규칙이고, 관계는 `relationships`로만 바꾼다. FK를 열면 같은 것을
 * 바꾸는 길이 두 개가 되고 둘의 검증 규칙이 갈라진다.
 *
 * 길이 제한은 엔티티 컬럼과 같은 값을 쓴다. 스키마가 더 느슨하면 DB가 거절해
 * 400이어야 할 것이 500으로 나간다.
 */

/** ISO 8601 문자열을 `Date`로 바꾼다. 저장 계층이 받는 형식이다. */
function toDate({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? new Date(value) : value;
}

/** `POST /api/v1/examples`의 본문 attributes. */
export class ExampleCreate {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  @IsOptional()
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  // `@Transform`이 `plainToInstance` 단계에서 돌아 검증기는 이미 `Date`를 본다.
  // 그래서 `@IsISO8601`이 아니라 `@IsDate`다 — `new Date('어제')`는 Invalid Date라
  // `@IsDate`가 잡는다.
  @IsOptional()
  @Transform(toDate)
  @IsDate()
  publishedAt?: Date | null;
}

/**
 * `PATCH /api/v1/examples/{id}`의 본문 attributes.
 *
 * 모든 필드가 선택이다. 무엇을 실제로 바꿀지는 이 스키마가 아니라 요청이 보낸 키
 * 집합(`presentKeys`)이 정한다 — 스펙 7.1.
 */
export class ExampleUpdate {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  @IsOptional()
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  @IsOptional()
  @Transform(toDate)
  @IsDate()
  publishedAt?: Date | null;
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
  body?: string | null;

  @IsOptional()
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  @IsOptional()
  @Transform(toDate)
  @IsDate()
  publishedAt?: Date | null;
}

/** 쓰기로 여는 관계. 여기 없는 관계는 읽기 전용이 된다. */
export const EXAMPLE_RELATIONSHIPS: RelationshipWriteSchema = {
  category: { cardinality: 'one', type: 'categories', model: Category },
  tags: { cardinality: 'many', type: 'tags', model: Tag },
};
```

- [ ] **Step 5: 재export한다**

`src/app/schemas/index.ts`에 더한다.

```ts
export { EXAMPLE_RELATIONSHIPS, ExampleCreate, ExampleReplace, ExampleUpdate } from './example.schemas.js';
export { validateAttributes } from './write-schema.js';
export type { RelationshipWriteRule, RelationshipWriteSchema } from './write-schema.js';
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/schemas`
Expected: PASS

- [ ] **Step 7: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`

- [ ] **Step 8: 커밋한다**

```bash
git add src/app/schemas test/schemas
git commit -m "feat(schemas): 쓰기 DTO 검증기와 Example 쓰기 계약 추가"
```

---
### Task 3: 요청 문서 파싱과 부분 갱신 적용

**Files:**
- Create: `src/app/controllers/concerns/document-parsing.ts`
- Test: `test/controllers/document-parsing.spec.ts`

**Interfaces:**
- Consumes: `parseResourceInput`, `ParseResourceOptions`, `RelationshipInput` (`src/app/jsonapi/document.ts`); `validateAttributes` (Task 2)
- Produces:
  - `interface ParsedWrite<D extends object> { attributes: D; presentKeys: ReadonlySet<string>; relationships: Record<string, RelationshipInput>; id: string | undefined }`
  - `function parseWriteDocument<D extends object>(body: unknown, schema: ClassConstructor<D>, options: ParseResourceOptions): Promise<ParsedWrite<D>>`
  - `function applyAttributes<T extends object>(entity: T, attributes: object, presentKeys: ReadonlySet<string>): void`

**왜 이 파일 하나가 소유하는가 (스펙 7.1):** class-validator에는 Pydantic의 `MISSING` sentinel에 해당하는 것이 없다. "보내지 않은 필드"와 "`null`로 보낸 필드"를 가르는 유일한 근거는 `plainToInstance` **이전**의 원본 키 집합이고, 그것을 잡는 곳이 여기다. 액션이 원본 본문을 다시 읽지 않는다 — 두 곳에서 읽으면 두 해석이 갈라진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/controllers/document-parsing.spec.ts`:

```ts
import { IsOptional, IsString, Length } from 'class-validator';
import {
  applyAttributes,
  parseWriteDocument,
} from '../../src/app/controllers/concerns/document-parsing.js';
import { JsonApiError, JsonApiErrors } from '../../src/app/jsonapi/errors.js';

class Sample {
  @IsOptional()
  @IsString()
  @Length(1, 10)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string | null;
}

function document(data: Record<string, unknown>): unknown {
  return { data: { type: 'samples', ...data } };
}

async function caughtError(run: () => Promise<unknown>): Promise<JsonApiError> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('parseWriteDocument', () => {
  it('검증을 마친 attributes를 돌려준다', async () => {
    const parsed = await parseWriteDocument(
      document({ attributes: { title: '제목' } }),
      Sample,
      { expectedType: 'samples' },
    );
    expect(parsed.attributes).toBeInstanceOf(Sample);
    expect(parsed.attributes.title).toBe('제목');
  });

  it('요청이 실제로 보낸 키만 presentKeys에 담는다', async () => {
    // 스펙 7.1의 핵심. 스키마에 선언된 필드가 아니라 요청이 보낸 키다.
    const parsed = await parseWriteDocument(
      document({ attributes: { title: '제목' } }),
      Sample,
      { expectedType: 'samples' },
    );
    expect([...parsed.presentKeys]).toEqual(['title']);
  });

  it('null로 보낸 필드도 보낸 것으로 센다', async () => {
    // "보내지 않음"과 "null로 보냄"을 가르는 것이 이 계층의 존재 이유다.
    const parsed = await parseWriteDocument(
      document({ attributes: { body: null } }),
      Sample,
      { expectedType: 'samples' },
    );
    expect(parsed.presentKeys.has('body')).toBe(true);
    expect(parsed.attributes.body).toBeNull();
  });

  it('attributes가 아예 없으면 presentKeys가 빈다', async () => {
    const parsed = await parseWriteDocument(document({}), Sample, { expectedType: 'samples' });
    expect(parsed.presentKeys.size).toBe(0);
  });

  it('relationships를 그대로 넘긴다', async () => {
    const parsed = await parseWriteDocument(
      document({ relationships: { owner: { data: { type: 'users', id: 'u1' } } } }),
      Sample,
      { expectedType: 'samples' },
    );
    expect(parsed.relationships.owner).toEqual({ data: { type: 'users', id: 'u1' } });
  });

  it('문서의 id를 돌려준다', async () => {
    const parsed = await parseWriteDocument(
      document({ id: 's1', attributes: { title: '제목' } }),
      Sample,
      { expectedType: 'samples', expectedId: 's1' },
    );
    expect(parsed.id).toBe('s1');
  });

  it('문서 구조 오류를 그대로 올려보낸다', async () => {
    // 구조 판정은 `parseResourceInput`이 소유한다. 여기서 다시 만들지 않는다.
    const error = await caughtError(() =>
      parseWriteDocument({ data: null }, Sample, { expectedType: 'samples' }),
    );
    expect(error.code).toBe('INVALID_JSONAPI_DOCUMENT');
  });

  it('타입이 다르면 TYPE_MISMATCH다', async () => {
    const error = await caughtError(() =>
      parseWriteDocument({ data: { type: 'others' } }, Sample, { expectedType: 'samples' }),
    );
    expect(error.code).toBe('TYPE_MISMATCH');
  });

  it('값 검증 실패는 VALIDATION_ERROR 집합이다', async () => {
    // 400(구조)과 422(값)의 경계가 이 두 테스트로 고정된다.
    await expect(
      parseWriteDocument(document({ attributes: { title: '' } }), Sample, {
        expectedType: 'samples',
      }),
    ).rejects.toThrow(JsonApiErrors);
  });
});

describe('applyAttributes', () => {
  it('보낸 키만 옮긴다', () => {
    const entity = { title: '원래 제목', body: '원래 본문' };
    applyAttributes(entity, { title: '새 제목', body: '새 본문' }, new Set(['title']));
    expect(entity).toEqual({ title: '새 제목', body: '원래 본문' });
  });

  it('null도 옮긴다', () => {
    const entity: { body: string | null } = { body: '원래 본문' };
    applyAttributes(entity, { body: null }, new Set(['body']));
    expect(entity.body).toBeNull();
  });

  it('보낸 키인데 스키마에 없으면 건너뛴다', () => {
    // whitelist가 걸러낸 뒤라 정상 경로에서는 일어나지 않지만, 여기서 조용히
    // undefined를 덮어쓰면 멀쩡한 값이 지워진다.
    const entity = { title: '원래 제목' };
    applyAttributes(entity, {}, new Set(['title']));
    expect(entity.title).toBe('원래 제목');
  });

  it('보내지 않은 키는 건드리지 않는다', () => {
    const entity = { title: '원래 제목' };
    applyAttributes(entity, { title: '새 제목' }, new Set());
    expect(entity.title).toBe('원래 제목');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers`
Expected: FAIL — `Cannot find module '../../src/app/controllers/concerns/document-parsing.js'`

- [ ] **Step 3: 구현한다**

`src/app/controllers/concerns/document-parsing.ts`:

```ts
import type { ClassConstructor } from 'class-transformer';
import { parseResourceInput } from '../../jsonapi/document.js';
import type { ParseResourceOptions, RelationshipInput } from '../../jsonapi/document.js';
import { validateAttributes } from '../../schemas/write-schema.js';

/**
 * 요청 문서 파싱과 부분 갱신 적용.
 *
 * **이 파일 하나가 `presentKeys`를 소유한다.** class-validator에는 Pydantic의
 * `MISSING` sentinel에 해당하는 것이 없어서, "보내지 않은 필드"와 "`null`로 보낸
 * 필드"를 가르는 유일한 근거는 `plainToInstance` 이전의 원본 키 집합이다. 액션이
 * 원본 본문을 다시 읽지 않는 이유가 그것이다 — 두 곳에서 읽으면 두 해석이 갈라진다.
 *
 * 오류의 경계도 여기서 갈린다. 문서 구조는 `parseResourceInput`이 400으로 거절하고,
 * 값은 `validateAttributes`가 422로 거절한다.
 */

/** 검증을 마친 쓰기 요청. */
export interface ParsedWrite<D extends object> {
  readonly attributes: D;
  /** 요청이 실제로 보낸 attribute 키. 스키마 필드 목록이 아니다. */
  readonly presentKeys: ReadonlySet<string>;
  readonly relationships: Record<string, RelationshipInput>;
  readonly id: string | undefined;
}

/** 자원 쓰기 문서를 파싱하고 attributes를 스키마로 검증한다. */
export async function parseWriteDocument<D extends object>(
  body: unknown,
  schema: ClassConstructor<D>,
  options: ParseResourceOptions,
): Promise<ParsedWrite<D>> {
  const parsed = parseResourceInput(body, options);
  const attributes = await validateAttributes(schema, parsed.attributes);
  return {
    attributes,
    presentKeys: parsed.presentKeys,
    relationships: parsed.relationships,
    id: parsed.id,
  };
}

/**
 * 요청이 보낸 필드만 엔티티에 옮긴다.
 *
 * `Object.assign`을 쓰지 않는 이유: 스키마 인스턴스에는 보내지 않은 선택 필드가
 * `undefined`로 존재할 수 있고, 그것을 통째로 덮으면 PATCH가 전체 교체가 된다.
 *
 * `Reflect`로 읽고 쓰는 이유: 제네릭 객체의 문자열 키 접근은 인덱스 시그니처를
 * 요구하는데, 엔티티에 인덱스 시그니처를 붙이면 오타 난 프로퍼티가 타입 검사를
 * 통과하게 된다. 읽은 값은 곧바로 `unknown`으로 받아 `any`가 번지지 않게 막는다.
 */
export function applyAttributes<T extends object>(
  entity: T,
  attributes: object,
  presentKeys: ReadonlySet<string>,
): void {
  for (const key of presentKeys) {
    if (!(key in attributes)) {
      continue;
    }
    const value: unknown = Reflect.get(attributes, key);
    Reflect.set(entity, key, value);
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/controllers/concerns/document-parsing.ts test/controllers/document-parsing.spec.ts
git commit -m "feat(controllers): 요청 문서 파싱과 presentKeys 기반 부분 갱신 추가"
```

---

### Task 4: 선언 계약과 prefix 검증

**Files:**
- Create: `src/app/controllers/concerns/crud-base.ts`
- Create: `src/app/controllers/concerns/jsonapi-controller.ts`
- Test: `test/controllers/jsonapi-controller.spec.ts`

**Interfaces:**
- Consumes: `ResourceSerializer` (`src/app/serializers/serializer.js`); `QueryPolicy` (`src/app/schemas/query-policy.js`); `RelationshipWriteSchema` (Task 2)
- Produces:
  - `interface CrudHooks<T>` — `beforeSave?`, `afterSave?`, `beforeDestroy?`
  - `interface CrudDeclaration<T, C, U>` — 스펙 6.1의 옵션 묶음
  - `function normalizeControllerPath(path: unknown): string`
  - `function assertResourcePath(controller: Function, resourcePath: string | undefined): void`

**prefix 검증이 팩토리가 아니라 생성자에서 도는 이유:** 스펙 6.1은 "팩토리가 조립 시점에 `@Controller` 경로와 `serializer.resourcePath`를 비교"하라고 한다. 그런데 팩토리는 **베이스 클래스를 만드는 시점**에 돌고, `@Controller`는 그 뒤에 서브클래스에 붙는다 — 팩토리 안에서는 비교할 경로가 아직 없다. 그래서 검사를 베이스 생성자로 옮겨 Nest가 컨트롤러를 인스턴스화할 때 돌게 한다. 실패는 첫 요청이 아니라 **부트스트랩**에서 나므로, 스펙이 막으려던 "잘못된 링크가 조용히 나가는" 상황은 그대로 막힌다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/controllers/jsonapi-controller.spec.ts`:

```ts
import { Controller } from '@nestjs/common';
import {
  assertResourcePath,
  normalizeControllerPath,
} from '../../src/app/controllers/concerns/jsonapi-controller.js';

describe('normalizeControllerPath', () => {
  it('앞에 슬래시를 붙이고 끝 슬래시를 뗀다', () => {
    expect(normalizeControllerPath('api/v1/examples')).toBe('/api/v1/examples');
    expect(normalizeControllerPath('/api/v1/examples/')).toBe('/api/v1/examples');
  });

  it('배열로 온 경로는 첫 값을 쓴다', () => {
    // `@Controller(['a', 'b'])`가 가능하다. 첫 경로가 self 링크의 기준이 된다.
    expect(normalizeControllerPath(['api/v1/examples'])).toBe('/api/v1/examples');
  });

  it('경로가 없으면 루트다', () => {
    expect(normalizeControllerPath(undefined)).toBe('/');
    expect(normalizeControllerPath('')).toBe('/');
  });
});

describe('assertResourcePath', () => {
  it('경로가 같으면 통과한다', () => {
    @Controller('api/v1/examples')
    class Matching {}

    expect(() => {
      assertResourcePath(Matching, '/api/v1/examples');
    }).not.toThrow();
  });

  it('경로가 어긋나면 던진다', () => {
    // 두 값이 갈리면 self 링크와 Location 헤더가 존재하지 않는 URL을 가리킨다.
    // 첫 요청이 아니라 부트스트랩에서 터져야 한다.
    @Controller('api/v1/samples')
    class Mismatched {}

    expect(() => {
      assertResourcePath(Mismatched, '/api/v1/examples');
    }).toThrow(/api\/v1\/samples/);
  });

  it('시리얼라이저에 resourcePath가 없으면 던진다', () => {
    // 라우트를 가진 자원은 반드시 링크 기준을 선언해야 한다. include 전용
    // 시리얼라이저를 컨트롤러에 붙이는 것은 선언 실수다.
    @Controller('api/v1/examples')
    class Pathless {}

    expect(() => {
      assertResourcePath(Pathless, undefined);
    }).toThrow(TypeError);
  });

  it('끝 슬래시 차이는 문제 삼지 않는다', () => {
    @Controller('api/v1/examples/')
    class Trailing {}

    expect(() => {
      assertResourcePath(Trailing, '/api/v1/examples');
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers`
Expected: FAIL — `Cannot find module '../../src/app/controllers/concerns/jsonapi-controller.js'`

- [ ] **Step 3: prefix 검증을 만든다**

`src/app/controllers/concerns/jsonapi-controller.ts`:

```ts
import { PATH_METADATA } from '@nestjs/common/constants.js';

/**
 * 컨트롤러 경로와 시리얼라이저의 링크 기준이 어긋나지 않게 한다.
 *
 * 스펙 6.1: `self` 링크와 `POST`·`PUT`의 `Location`은 `serializer.resourcePath`에서
 * 나오고, 실제 라우트는 `@Controller` 경로에서 나온다. 두 값이 갈리면 잘못된 링크가
 * **조용히** 나간다 — 참조 구현이 감지하지 못하던 실패이고, 이 템플릿이 의도적으로
 * 하나 줄이기로 한 것이다.
 *
 * 검사는 팩토리가 아니라 베이스 생성자에서 돈다. 팩토리는 베이스를 만드는 시점에
 * 도는데 `@Controller`는 그 뒤에 서브클래스에 붙으므로, 팩토리 안에서는 비교할
 * 경로가 아직 없다. 생성자로 옮기면 Nest가 컨트롤러를 만드는 부트스트랩에서 터진다.
 */

/** `@Controller` 경로를 `/`로 시작하고 끝나지 않는 형태로 맞춘다. */
export function normalizeControllerPath(path: unknown): string {
  const raw = Array.isArray(path) ? path[0] : path;
  if (typeof raw !== 'string' || raw === '' || raw === '/') {
    return '/';
  }
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.length > 1 && withLeading.endsWith('/')
    ? withLeading.slice(0, -1)
    : withLeading;
}

/** 컨트롤러 경로와 `resourcePath`가 문자열까지 같은지 확인한다. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- Nest 메타데이터의 target 타입이 Function이다
export function assertResourcePath(controller: Function, resourcePath: string | undefined): void {
  if (resourcePath === undefined) {
    throw new TypeError(
      `${controller.name}이(가) 쓰는 시리얼라이저에 resourcePath가 없다. 라우트를 가진 자원은 링크 기준을 선언해야 한다`,
    );
  }
  const declared = normalizeControllerPath(Reflect.getMetadata(PATH_METADATA, controller));
  const expected = normalizeControllerPath(resourcePath);
  if (declared !== expected) {
    throw new TypeError(
      `${controller.name}의 @Controller 경로(${declared})와 시리얼라이저의 resourcePath(${expected})가 다르다`,
    );
  }
}
```

- [ ] **Step 4: 선언 계약을 만든다**

`src/app/controllers/concerns/crud-base.ts`:

```ts
import type { CanActivate, Type } from '@nestjs/common';
import type { ClassConstructor } from 'class-transformer';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryPolicy } from '../../schemas/query-policy.js';
import type { RelationshipWriteSchema } from '../../schemas/write-schema.js';
import type { ResourceSerializer } from '../../serializers/serializer.js';

/**
 * 자원 컨트롤러가 선언하는 것의 전부.
 *
 * 이 묶음에 없는 것은 `CrudActions`가 알 수 없고, 알 수 없는 것은 하지 않는다.
 * 자원별 service 계층을 만들지 않는다는 스펙 4장의 규칙이 여기서 지켜진다 —
 * 도메인 개입이 필요하면 훅을 쓰고, 훅으로 안 되면 그 자원은 `CrudActions`를
 * 쓰지 않는 편이 낫다.
 */

/** 저장·삭제 전후에 끼어드는 자리. 선언하지 않으면 아무 일도 하지 않는다. */
export interface CrudHooks<T extends ObjectLiteral> {
  /** 저장 직전. 파생 필드 계산처럼 같은 트랜잭션에서 끝나야 하는 일을 둔다. */
  beforeSave?(entity: T, manager: EntityManager): Promise<void> | void;
  /** 저장 직후, 같은 트랜잭션 안. 여기서 던지면 저장도 함께 롤백된다. */
  afterSave?(entity: T, manager: EntityManager): Promise<void> | void;
  /** 삭제 직전, 같은 트랜잭션 안. */
  beforeDestroy?(entity: T, manager: EntityManager): Promise<void> | void;
}

/** `CrudActions`에 넘기는 선언. */
export interface CrudDeclaration<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
> extends CrudHooks<T> {
  readonly model: EntityTarget<T>;
  readonly serializer: ResourceSerializer<T>;
  /** `POST` 본문의 attributes 스키마. */
  readonly createSchema: ClassConstructor<C>;
  /** `PATCH` 본문의 attributes 스키마. 모든 필드가 선택이어야 한다. */
  readonly updateSchema: ClassConstructor<U>;
  /**
   * `PUT` 본문의 attributes 스키마. Phase 5의 upsert가 쓴다.
   *
   * `enableUpsert`가 참인데 이 값이 없으면 조립 시점에 던진다 — 라우트만 열리고
   * 검증이 비는 상태가 조용히 만들어지는 것을 막는다.
   */
  readonly replaceSchema?: ClassConstructor<object>;
  /** 쓰기로 여는 관계. 여기 없는 관계는 읽기 전용이 된다. */
  readonly relationshipsSchema: RelationshipWriteSchema;
  readonly queryPolicy: QueryPolicy;
  /** `PUT` 라우트를 열지. 기본은 열지 않는다. */
  readonly enableUpsert?: boolean;
  /**
   * 쓰기 메서드에만 붙는 가드.
   *
   * 읽기는 공개이고 쓰기는 인증을 요구한다는 스펙 16장의 구분이 여기서 갈린다.
   * Phase 6이 `JwtActiveUserGuard`를 여기에 넣는다.
   */
  readonly writeGuards?: readonly Type<CanActivate>[];
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers`
Expected: PASS

- [ ] **Step 6: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`

- [ ] **Step 7: 커밋한다**

```bash
git add src/app/controllers/concerns test/controllers/jsonapi-controller.spec.ts
git commit -m "feat(controllers): CrudActions 선언 계약과 prefix 검증 추가"
```

---
### Task 5: linkage 해석

**Files:**
- Modify: `src/app/jsonapi/document.ts` (`parseLinkageInput`에 pointer 기준 추가)
- Create: `src/app/controllers/concerns/relationship-resolver.ts`
- Test: `test/jsonapi/document.spec.ts` (추가), `test/integration/relationship-resolver.spec.ts`

**Interfaces:**
- Consumes: `parseLinkageInput`, `RelationshipInput`, `ResourceIdentifier` (`src/app/jsonapi/document.js`); `RelationshipWriteSchema` (Task 2)
- Produces:
  - `interface ResolvedLinkage { toOne: Record<string, ObjectLiteral | null>; toMany: Record<string, ObjectLiteral[]> }`
  - `function resolveRelationships(manager: EntityManager, schema: RelationshipWriteSchema, inputs: Readonly<Record<string, RelationshipInput>>): Promise<ResolvedLinkage>`
  - `function resolveOne(manager, rule, input, pointer): Promise<ObjectLiteral | ObjectLiteral[] | null>`

**왜 `parseLinkageInput`을 고치는가:** 지금은 오류 pointer가 `/data`로 고정돼 있다. 관계 라우트(`PATCH /{id}/relationships/tags`)에서는 그것이 맞지만, 자원 문서 안의 `relationships`에서는 `/data/relationships/tags/data`여야 한다. pointer가 틀리면 클라이언트가 어느 필드를 고쳐야 하는지 알 수 없다. linkage 파싱의 소유자를 둘로 늘리는 대신 기준 pointer를 인자로 받는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/document.spec.ts`의 `parseLinkageInput` describe에 더한다.

```ts
  it('pointer 기준을 바꿀 수 있다', () => {
    // 자원 문서 안의 relationships에서는 `/data`가 아니라 그 관계를 가리켜야 한다.
    let thrown: unknown;
    try {
      parseLinkageInput(
        { data: { type: 'others', id: 't1' } },
        { expectedType: 'tags', cardinality: 'one', pointer: '/data/relationships/tags/data' },
      );
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof JsonApiError)) {
      throw new Error('JsonApiError가 던져지지 않았다');
    }
    expect(thrown.source).toEqual({ pointer: '/data/relationships/tags/data/type' });
  });

  it('배열 항목의 pointer도 기준을 따른다', () => {
    let thrown: unknown;
    try {
      parseLinkageInput(
        { data: [{ type: 'tags', id: 't1' }, { type: 'tags' }] },
        { expectedType: 'tags', cardinality: 'many', pointer: '/data/relationships/tags/data' },
      );
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof JsonApiError)) {
      throw new Error('JsonApiError가 던져지지 않았다');
    }
    expect(thrown.source).toEqual({ pointer: '/data/relationships/tags/data/1/id' });
  });

  it('pointer를 주지 않으면 /data를 쓴다', () => {
    let thrown: unknown;
    try {
      parseLinkageInput({ data: { type: 'others', id: 't1' } }, {
        expectedType: 'tags',
        cardinality: 'one',
      });
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof JsonApiError)) {
      throw new Error('JsonApiError가 던져지지 않았다');
    }
    expect(thrown.source).toEqual({ pointer: '/data/type' });
  });
```

`test/integration/relationship-resolver.spec.ts`:

```ts
import type { DataSource } from 'typeorm';
import { resolveRelationships } from '../../src/app/controllers/concerns/relationship-resolver.js';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { EXAMPLE_RELATIONSHIPS } from '../../src/app/schemas/example.schemas.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

const MISSING = '0195c1a0-0000-7000-8000-0000000009ff';

async function caught(run: () => Promise<unknown>): Promise<JsonApiError> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('resolveRelationships', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('to-one linkage를 실제 행으로 해석한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const category = await manager.save(manager.create(Category, { name: '분류' }));
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        category: { data: { type: 'categories', id: category.id } },
      });
      expect(resolved.toOne.category).toBeInstanceOf(Category);
    });
  });

  it('to-one linkage의 null은 해제다', async () => {
    await withRollback(dataSource, async (manager) => {
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        category: { data: null },
      });
      expect(resolved.toOne.category).toBeNull();
    });
  });

  it('to-many linkage를 실제 행으로 해석한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const first = await manager.save(manager.create(Tag, { name: 'ㄱ' }));
      const second = await manager.save(manager.create(Tag, { name: 'ㄴ' }));
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        tags: { data: [{ type: 'tags', id: first.id }, { type: 'tags', id: second.id }] },
      });
      expect(resolved.toMany.tags).toHaveLength(2);
    });
  });

  it('to-many의 빈 배열은 전체 해제다', async () => {
    await withRollback(dataSource, async (manager) => {
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        tags: { data: [] },
      });
      expect(resolved.toMany.tags).toEqual([]);
    });
  });

  it('없는 대상은 RELATIONSHIP_RESOURCE_NOT_FOUND다', async () => {
    await withRollback(dataSource, async (manager) => {
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          category: { data: { type: 'categories', id: MISSING } },
        }),
      );
      expect(error.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
      expect(error.source).toEqual({ pointer: '/data/relationships/category/data' });
    });
  });

  it('to-many에서 하나만 없어도 거부한다', async () => {
    // 일부만 붙이면 클라이언트가 보낸 집합과 저장된 집합이 갈라진다.
    await withRollback(dataSource, async (manager) => {
      const tag = await manager.save(manager.create(Tag, { name: 'ㄱ' }));
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          tags: { data: [{ type: 'tags', id: tag.id }, { type: 'tags', id: MISSING }] },
        }),
      );
      expect(error.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
    });
  });

  it('쓰기로 열지 않은 관계를 거부한다', async () => {
    await withRollback(dataSource, async (manager) => {
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          author: { data: { type: 'users', id: 'u1' } },
        }),
      );
      expect(error.code).toBe('INVALID_JSONAPI_DOCUMENT');
      expect(error.source).toEqual({ pointer: '/data/relationships/author' });
    });
  });

  it('linkage type이 다르면 TYPE_MISMATCH다', async () => {
    await withRollback(dataSource, async (manager) => {
      const error = await caught(() =>
        resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
          tags: { data: [{ type: 'categories', id: MISSING }] },
        }),
      );
      expect(error.code).toBe('TYPE_MISMATCH');
    });
  });

  it('중복 id를 한 번만 붙인다', async () => {
    await withRollback(dataSource, async (manager) => {
      const tag = await manager.save(manager.create(Tag, { name: 'ㄱ' }));
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {
        tags: { data: [{ type: 'tags', id: tag.id }, { type: 'tags', id: tag.id }] },
      });
      expect(resolved.toMany.tags).toHaveLength(1);
    });
  });

  it('입력에 없는 관계는 결과에도 없다', async () => {
    // "보내지 않은 관계"와 "비우라고 보낸 관계"를 가른다.
    await withRollback(dataSource, async (manager) => {
      const resolved = await resolveRelationships(manager, EXAMPLE_RELATIONSHIPS, {});
      expect(Object.keys(resolved.toOne)).toEqual([]);
      expect(Object.keys(resolved.toMany)).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/document.spec.ts`
Expected: FAIL — `pointer`가 옵션에 없어 타입 오류

- [ ] **Step 3: `parseLinkageInput`에 pointer 기준을 넣는다**

`src/app/jsonapi/document.ts`의 `ParseLinkageOptions`에 더한다.

```ts
/** `parseLinkageInput` 옵션. */
export interface ParseLinkageOptions {
  readonly expectedType: string;
  readonly cardinality: 'one' | 'many';
  /**
   * 오류 `source.pointer`의 기준. 기본은 관계 라우트의 본문을 가리키는 `/data`다.
   *
   * 자원 문서 안의 `relationships`를 파싱할 때는 그 관계를 가리켜야 한다
   * (`/data/relationships/tags/data`). pointer가 틀리면 클라이언트가 어느 필드를
   * 고쳐야 하는지 알 수 없다.
   */
  readonly pointer?: string;
}
```

같은 파일의 `parseLinkageInput` 본문에서 `'/data'` 리터럴을 기준값으로 바꾼다.

```ts
export function parseLinkageInput(
  body: unknown,
  options: ParseLinkageOptions,
): ResourceIdentifier | ResourceIdentifier[] | null {
  const pointer = options.pointer ?? '/data';

  if (!isPlainObject(body)) {
    throw invalidDocument(undefined, 'request body must be a JSON object');
  }
  if (!('data' in body)) {
    throw invalidDocument(pointer, 'the document requires a "data" member');
  }

  const data = body.data;

  if (options.cardinality === 'one') {
    if (data === null) {
      return null;
    }
    if (Array.isArray(data)) {
      throw invalidDocument(pointer, 'a to-one relationship requires a single resource identifier');
    }
    return readIdentifier(data, options.expectedType, pointer);
  }

  if (!Array.isArray(data)) {
    throw invalidDocument(pointer, 'a to-many relationship requires an array of resource identifiers');
  }
  return data.map((entry, index) =>
    readIdentifier(entry, options.expectedType, `${pointer}/${String(index)}`),
  );
}
```

- [ ] **Step 4: 해석기를 만든다**

`src/app/controllers/concerns/relationship-resolver.ts`:

```ts
import { In } from 'typeorm';
import type { EntityManager, ObjectLiteral } from 'typeorm';
import { parseLinkageInput } from '../../jsonapi/document.js';
import type { RelationshipInput, ResourceIdentifier } from '../../jsonapi/document.js';
import { JsonApiError } from '../../jsonapi/errors.js';
import type { RelationshipWriteRule, RelationshipWriteSchema } from '../../schemas/write-schema.js';

/**
 * linkage를 실제 행으로 해석한다.
 *
 * 입력은 언제나 `ResourceIdentifier`뿐이다 — 내부 FK를 공개 입력으로 만들지 않는다는
 * 스펙 7.3의 규칙이고, 그래서 여기서 id를 행으로 바꾸는 단계가 필요하다.
 *
 * 하나라도 없으면 전체를 거부한다. 일부만 붙이면 클라이언트가 보낸 집합과 저장된
 * 집합이 갈라지는데, 응답만 봐서는 그 차이를 알 수 없다.
 */

/** 해석을 마친 관계. 입력에 없던 관계는 여기에도 없다. */
export interface ResolvedLinkage {
  readonly toOne: Record<string, ObjectLiteral | null>;
  readonly toMany: Record<string, ObjectLiteral[]>;
}

/** 식별자 목록을 행으로 바꾸고, 없는 것이 있으면 던진다. */
async function loadAll(
  manager: EntityManager,
  rule: RelationshipWriteRule,
  identifiers: readonly ResourceIdentifier[],
  pointer: string,
): Promise<ObjectLiteral[]> {
  const ids = [...new Set(identifiers.map((identifier) => identifier.id))];
  if (ids.length === 0) {
    return [];
  }
  const rows = await manager.find(rule.model, { where: { id: In(ids) } });
  if (rows.length !== ids.length) {
    throw new JsonApiError('RELATIONSHIP_RESOURCE_NOT_FOUND', {
      source: { pointer },
      detail: `one or more "${rule.type}" resources do not exist`,
    });
  }
  return rows;
}

/**
 * 관계 하나의 linkage를 해석한다.
 *
 * 관계 라우트가 직접 쓰는 진입점이기도 하다 — 그쪽은 관계가 하나뿐이라 `pointer`가
 * `/data`다.
 */
export async function resolveOne(
  manager: EntityManager,
  rule: RelationshipWriteRule,
  input: RelationshipInput,
  pointer: string,
): Promise<ObjectLiteral | ObjectLiteral[] | null> {
  const linkage = parseLinkageInput(input, {
    expectedType: rule.type,
    cardinality: rule.cardinality,
    pointer,
  });

  if (linkage === null) {
    return null;
  }
  if (Array.isArray(linkage)) {
    return loadAll(manager, rule, linkage, pointer);
  }
  const [row] = await loadAll(manager, rule, [linkage], pointer);
  if (row === undefined) {
    throw new JsonApiError('RELATIONSHIP_RESOURCE_NOT_FOUND', { source: { pointer } });
  }
  return row;
}

/** 자원 문서의 `relationships`를 통째로 해석한다. */
export async function resolveRelationships(
  manager: EntityManager,
  schema: RelationshipWriteSchema,
  inputs: Readonly<Record<string, RelationshipInput>>,
): Promise<ResolvedLinkage> {
  const toOne: Record<string, ObjectLiteral | null> = {};
  const toMany: Record<string, ObjectLiteral[]> = {};

  for (const [name, input] of Object.entries(inputs)) {
    const rule = schema[name];
    if (rule === undefined) {
      throw new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
        source: { pointer: `/data/relationships/${name}` },
        detail: `"${name}" is not a writable relationship`,
      });
    }

    const resolved = await resolveOne(
      manager,
      rule,
      input,
      `/data/relationships/${name}/data`,
    );

    if (rule.cardinality === 'many') {
      if (!Array.isArray(resolved)) {
        throw new TypeError(`to-many 관계가 배열이 아닌 결과를 냈다: ${name}`);
      }
      toMany[name] = resolved;
      continue;
    }
    if (Array.isArray(resolved)) {
      throw new TypeError(`to-one 관계가 배열 결과를 냈다: ${name}`);
    }
    toOne[name] = resolved;
  }

  return { toOne, toMany };
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `./scripts/check.sh`
Expected: exit 0

- [ ] **Step 6: 커밋한다**

```bash
git add src/app/jsonapi/document.ts src/app/controllers/concerns/relationship-resolver.ts test/jsonapi/document.spec.ts test/integration/relationship-resolver.spec.ts
git commit -m "feat(controllers): linkage를 실제 행으로 해석하는 관계 리졸버 추가"
```

---
### Task 6: 단건 조회 질의와 문서 조립 헬퍼

**Files:**
- Modify: `src/app/jsonapi/query.ts` (`parseSingleResourceQuery` 추가)
- Create: `src/app/controllers/concerns/documents.ts`
- Test: `test/jsonapi/query.spec.ts` (추가), `test/controllers/documents.spec.ts`

**Interfaces:**
- Produces:
  - `function parseSingleResourceQuery(query, policy, declaredRelationships): readonly string[]` (query.ts)
  - `interface SingleDocument { data: ResourceObject; included?: readonly ResourceObject[] }`
  - `interface CollectionDocument { data: readonly ResourceObject[]; included?: readonly ResourceObject[]; links: PaginationLinks; meta?: { totalCount: number } }`
  - `interface LinkageDocument { data: ResourceIdentifier | readonly ResourceIdentifier[] | null; links: { self: string; related: string } }`
  - `function singleDocument(data, included): SingleDocument`
  - `function collectionDocument(data, included, links, totalCount): CollectionDocument`

**왜 문서 조립을 따로 두는가:** 다섯 액션과 관계 액션이 모두 같은 모양을 만든다. 각자 객체 리터럴을 쓰면 `included`가 빌 때 `included: []`를 내는 곳과 멤버를 생략하는 곳이 갈린다 — JSON:API에서 그 둘은 다른 뜻이 아니지만, 응답 모양이 라우트마다 다른 것은 계약이 아니라 사고다.

`GET /{id}`가 `include`만 받는 이유: 단건에 `filter`·`sort`·`page`는 뜻이 없다. 받아 주면 클라이언트가 뜻이 있다고 오해한다(스펙 8.2가 to-one 관계 URL에 같은 규칙을 정한다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/query.spec.ts`에 더한다(import에 `parseSingleResourceQuery` 추가).

```ts
describe('parseSingleResourceQuery', () => {
  it('질의가 없으면 빈 include다', () => {
    expect(parseSingleResourceQuery({}, POLICY, DECLARED)).toEqual([]);
  });

  it('include를 해석한다', () => {
    expect(parseSingleResourceQuery({ include: 'category' }, POLICY, DECLARED)).toEqual(['category']);
  });

  it('include 외의 파라미터를 거부한다', () => {
    // 단건 조회에 filter·sort·page는 뜻이 없다.
    for (const key of ['filter[status]', 'sort', 'page[size]', 'q']) {
      const error = caught(() => parseSingleResourceQuery({ [key]: 'x' }, POLICY, DECLARED));
      expect(error.code).toBe('INVALID_QUERY_PARAMETER');
      expect(error.source).toEqual({ parameter: key });
    }
  });

  it('허용되지 않은 include는 INVALID_INCLUDE다', () => {
    expect(caught(() => parseSingleResourceQuery({ include: 'secret' }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });
});
```

`test/controllers/documents.spec.ts`:

```ts
import {
  collectionDocument,
  singleDocument,
} from '../../src/app/controllers/concerns/documents.js';
import type { ResourceObject } from '../../src/app/serializers/serializer.js';

const RESOURCE: ResourceObject = {
  type: 'examples',
  id: 'e1',
  attributes: { title: '제목' },
  relationships: {},
  links: { self: '/api/v1/examples/e1' },
};

const LINKS = { self: '/api/v1/examples?page[number]=1&page[size]=25' };

describe('singleDocument', () => {
  it('data를 담는다', () => {
    expect(singleDocument(RESOURCE, [])).toEqual({ data: RESOURCE });
  });

  it('included가 비면 멤버를 생략한다', () => {
    // 빈 배열을 내면 "포함을 요청했는데 아무것도 없다"와 "포함을 요청하지 않았다"가
    // 같은 모양이 된다.
    expect('included' in singleDocument(RESOURCE, [])).toBe(false);
  });

  it('included가 있으면 담는다', () => {
    const document = singleDocument(RESOURCE, [RESOURCE]);
    expect(document.included).toHaveLength(1);
  });
});

describe('collectionDocument', () => {
  it('data와 links를 담는다', () => {
    const document = collectionDocument([RESOURCE], [], LINKS, undefined);
    expect(document.data).toHaveLength(1);
    expect(document.links).toBe(LINKS);
  });

  it('빈 컬렉션도 data가 배열이다', () => {
    // JSON:API는 빈 컬렉션을 `null`이 아니라 `[]`로 요구한다.
    expect(collectionDocument([], [], LINKS, undefined).data).toEqual([]);
  });

  it('총 개수를 모르면 meta를 생략한다', () => {
    expect('meta' in collectionDocument([RESOURCE], [], LINKS, undefined)).toBe(false);
  });

  it('총 개수를 알면 meta.totalCount로 담는다', () => {
    expect(collectionDocument([RESOURCE], [], LINKS, 42).meta).toEqual({ totalCount: 42 });
  });

  it('총 개수가 0이어도 담는다', () => {
    // `0`을 falsy로 흘리면 "0건"이 "모른다"로 바뀐다.
    expect(collectionDocument([], [], LINKS, 0).meta).toEqual({ totalCount: 0 });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers test/jsonapi/query.spec.ts`
Expected: FAIL

- [ ] **Step 3: 단건 질의 파서를 더한다**

`src/app/jsonapi/query.ts`에 더한다.

```ts
/**
 * 단건 조회(`GET /{id}`)의 질의를 해석한다.
 *
 * `include`만 받는다. 자원 하나를 가리키는 경로에서 `filter`·`sort`·`page`는 뜻이
 * 없고, 받아 주면 클라이언트가 뜻이 있다고 오해한다 — 스펙 8.2가 to-one 관계 URL에
 * 같은 규칙을 정하는 것과 같은 이유다.
 */
export function parseSingleResourceQuery(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
  declaredRelationships: readonly string[],
): readonly string[] {
  for (const key of Object.keys(query)) {
    if (key !== 'include') {
      throw invalidParameter(key, 'a single resource endpoint only supports include');
    }
  }
  return parseInclude(query, policy, declaredRelationships);
}
```

- [ ] **Step 4: 문서 조립기를 만든다**

`src/app/controllers/concerns/documents.ts`:

```ts
import type { ResourceIdentifier } from '../../jsonapi/document.js';
import type { PaginationLinks } from '../../jsonapi/pagination.js';
import type { ResourceObject } from '../../serializers/serializer.js';

/**
 * 응답 문서 조립.
 *
 * 다섯 액션과 관계 액션이 모두 같은 모양을 만든다. 각자 객체 리터럴을 쓰면
 * `included`가 빌 때 빈 배열을 내는 곳과 멤버를 생략하는 곳이 갈린다 — 응답 모양이
 * 라우트마다 다른 것은 계약이 아니라 사고다.
 */

/** 자원 하나를 담은 문서. */
export interface SingleDocument {
  readonly data: ResourceObject;
  readonly included?: readonly ResourceObject[];
}

/** 자원 목록을 담은 문서. */
export interface CollectionDocument {
  readonly data: readonly ResourceObject[];
  readonly included?: readonly ResourceObject[];
  readonly links: PaginationLinks;
  readonly meta?: { readonly totalCount: number };
}

/** 관계의 linkage 문서. */
export interface LinkageDocument {
  readonly data: ResourceIdentifier | readonly ResourceIdentifier[] | null;
  readonly links: { readonly self: string; readonly related: string };
}

/** 자원 하나를 문서로 만든다. `included`가 비면 멤버를 생략한다. */
export function singleDocument(
  data: ResourceObject,
  included: readonly ResourceObject[],
): SingleDocument {
  return { data, ...(included.length === 0 ? {} : { included }) };
}

/**
 * 자원 목록을 문서로 만든다.
 *
 * `totalCount`는 `undefined`("세지 않았다")와 `0`("없다")을 가른다. `0`을 falsy로
 * 흘리면 두 뜻이 하나로 뭉개진다.
 */
export function collectionDocument(
  data: readonly ResourceObject[],
  included: readonly ResourceObject[],
  links: PaginationLinks,
  totalCount: number | undefined,
): CollectionDocument {
  return {
    data,
    ...(included.length === 0 ? {} : { included }),
    links,
    ...(totalCount === undefined ? {} : { meta: { totalCount } }),
  };
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers test/jsonapi`
Expected: PASS

- [ ] **Step 6: 커밋한다**

```bash
git add src/app/jsonapi/query.ts src/app/controllers/concerns/documents.ts test/jsonapi/query.spec.ts test/controllers/documents.spec.ts
git commit -m "feat(controllers): 단건 조회 질의와 응답 문서 조립기 추가"
```

---

### Task 7: 라우트 등록기

**Files:**
- Create: `src/app/controllers/concerns/route-registrar.ts`
- Test: `test/controllers/route-registrar.spec.ts`

**Interfaces:**
- Consumes: `CrudDeclaration` (Task 4)
- Produces:
  - `const RESOURCE_ALIAS = 'resource'`
  - `interface RegisteredRoutes { relationshipNames: readonly string[] }`
  - `function registerRoutes(host: Type<object>, declaration: CrudDeclaration<never, never, never>): RegisteredRoutes` — 실제 시그니처는 아래 코드 참고
  - 프로토타입에 정의되는 델리게이트 이름: `showRelationship$<rel>`, `updateRelationship$<rel>`, `addRelationship$<rel>`, `removeRelationship$<rel>`, `showRelated$<rel>`

**계약 (스펙 6.3·7.3·16):**
- 정적 라우트: `GET ''`, `POST ''`, `GET ':id'`, `PATCH ':id'`, `DELETE ':id'`
- 관계 라우트 등록 대상은 **시리얼라이저 `relationships` 키와 `relationshipsSchema` 필드의 교집합**
- to-one: `GET`/`PATCH` `:id/relationships/<rel>`, to-many: 거기에 `POST`/`DELETE` 추가
- 모든 관계에 `GET ':id/<rel>'`(related)
- 관계 mutation과 `DELETE`는 `204`, `POST`는 `201`
- `writeGuards`는 쓰기 메서드에만 붙는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/controllers/route-registrar.spec.ts`:

```ts
import { Controller, Injectable } from '@nestjs/common';
import type { CanActivate, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { RESOURCE_ALIAS, registerRoutes } from '../../src/app/controllers/concerns/route-registrar.js';
import { EXAMPLE_RELATIONSHIPS, ExampleCreate, ExampleUpdate } from '../../src/app/schemas/example.schemas.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
import { Example } from '../../src/app/models/example.entity.js';
import { registeredRoutes } from '../app-factory.js';

@Injectable()
class NeverGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

/** 라우트 등록만 확인하는 최소 호스트. 액션 본문은 이 태스크의 관심사가 아니다. */
function hostFor(overrides: { enableUpsert?: boolean; writeGuards?: CanActivate[] } = {}) {
  class Host {}
  const declaration = {
    model: Example,
    serializer: EXAMPLE_SERIALIZER,
    createSchema: ExampleCreate,
    updateSchema: ExampleUpdate,
    relationshipsSchema: EXAMPLE_RELATIONSHIPS,
    queryPolicy: EXAMPLE_QUERY_POLICY,
    ...overrides,
  };
  const registered = registerRoutes(Host, declaration);
  return { Host, registered };
}

describe('RESOURCE_ALIAS', () => {
  it('질의 별칭을 고정한다', () => {
    expect(RESOURCE_ALIAS).toBe('resource');
  });
});

describe('registerRoutes 등록 대상', () => {
  it('시리얼라이저와 관계 스키마의 교집합만 등록한다', () => {
    const { registered } = hostFor();
    expect([...registered.relationshipNames].sort()).toEqual(['category', 'tags']);
  });

  it('관계 스키마에 없는 관계는 등록하지 않는다', () => {
    class Host {}
    const registered = registerRoutes(Host, {
      model: Example,
      serializer: EXAMPLE_SERIALIZER,
      createSchema: ExampleCreate,
      updateSchema: ExampleUpdate,
      relationshipsSchema: { category: EXAMPLE_RELATIONSHIPS.category! },
      queryPolicy: EXAMPLE_QUERY_POLICY,
    });
    expect(registered.relationshipNames).toEqual(['category']);
  });
});

describe('registerRoutes가 만드는 라우트', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const { Host } = hostFor();

    @Controller('api/v1/examples')
    class ExamplesProbe extends Host {}

    const moduleRef = await Test.createTestingModule({ controllers: [ExamplesProbe] }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('스펙 16장의 라우트를 정확히 만든다', () => {
    expect(registeredRoutes(app)).toEqual([
      'DELETE /api/v1/examples/:id',
      'DELETE /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples',
      'GET /api/v1/examples/:id',
      'GET /api/v1/examples/:id/category',
      'GET /api/v1/examples/:id/relationships/category',
      'GET /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples/:id/tags',
      'PATCH /api/v1/examples/:id',
      'PATCH /api/v1/examples/:id/relationships/category',
      'PATCH /api/v1/examples/:id/relationships/tags',
      'POST /api/v1/examples',
      'POST /api/v1/examples/:id/relationships/tags',
    ]);
  });

  it('to-one 관계에는 POST와 DELETE를 만들지 않는다', () => {
    // 스펙 7.3: to-one은 GET/PATCH뿐이다. 목록에 더하고 빼는 개념이 없다.
    const routes = registeredRoutes(app);
    expect(routes).not.toContain('POST /api/v1/examples/:id/relationships/category');
    expect(routes).not.toContain('DELETE /api/v1/examples/:id/relationships/category');
  });

  it('enableUpsert가 아니면 PUT을 만들지 않는다', () => {
    expect(registeredRoutes(app)).not.toContain('PUT /api/v1/examples/:id');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers/route-registrar.spec.ts`
Expected: FAIL — `Cannot find module '../../src/app/controllers/concerns/route-registrar.js'`

- [ ] **Step 3: 구현한다**

`src/app/controllers/concerns/route-registrar.ts`:

```ts
import {
  Body,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CanActivate, Type } from '@nestjs/common';
import type { ObjectLiteral } from 'typeorm';
import type { CrudDeclaration } from './crud-base.js';

/**
 * 프로토타입에 라우트를 붙인다.
 *
 * 정적 액션은 이름과 경로가 고정이라 그대로 데코레이터를 함수로 적용한다. 관계
 * 라우트는 개수가 선언에 따라 달라지므로 프로토타입에 델리게이트 메서드를 만들고
 * 거기에 적용한다 — 스펙 6.3이 검증한 방식이고, 이래야 OpenAPI에 관계마다 개별
 * 경로가 노출된다.
 *
 * 등록 대상은 **시리얼라이저 `relationships` 키와 `relationshipsSchema` 필드의
 * 교집합**이다. 이름이 어긋나면 쓰기 관계 라우트가 조용히 사라지므로, 이 규칙은
 * 라우트 조립 테스트가 고정한다.
 */

/** 질의 빌더의 별칭. 정책의 property가 이 별칭 뒤에 붙는다. */
export const RESOURCE_ALIAS = 'resource';

/** 등록 결과. 액션이 관계 이름 목록을 다시 계산하지 않게 돌려준다. */
export interface RegisteredRoutes {
  readonly relationshipNames: readonly string[];
}

/** 프로토타입 메서드에 데코레이터를 적용한다. 없으면 조립 실수이므로 던진다. */
function decorate(
  proto: object,
  name: string,
  apply: (descriptor: PropertyDescriptor) => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  if (descriptor === undefined) {
    throw new TypeError(`프로토타입에 ${name}이(가) 없다`);
  }
  apply(descriptor);
}

/** 쓰기 메서드에만 가드를 붙인다. */
function guardWrites(
  proto: object,
  names: readonly string[],
  guards: readonly Type<CanActivate>[],
): void {
  if (guards.length === 0) {
    return;
  }
  for (const name of names) {
    decorate(proto, name, (descriptor) => {
      UseGuards(...guards)(proto, name, descriptor);
    });
  }
}

/** 선언을 읽어 라우트를 등록한다. */
export function registerRoutes<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
>(host: Type<object>, declaration: CrudDeclaration<T, C, U>): RegisteredRoutes {
  const proto: object = host.prototype;
  const writeMethods: string[] = ['create', 'update', 'destroy'];

  decorate(proto, 'index', (descriptor) => {
    Get()(proto, 'index', descriptor);
    Query()(proto, 'index', 0);
  });

  decorate(proto, 'show', (descriptor) => {
    Get(':id')(proto, 'show', descriptor);
    Param('id')(proto, 'show', 0);
    Query()(proto, 'show', 1);
  });

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

  const declared = Object.keys(declaration.serializer.relationships);
  const writable = Object.keys(declaration.relationshipsSchema);
  const relationshipNames = declared.filter((name) => writable.includes(name));

  for (const name of relationshipNames) {
    const rule = declaration.relationshipsSchema[name];
    if (rule === undefined) {
      throw new TypeError(`관계 규칙이 없다: ${name}`);
    }
    registerRelationship(proto, name, rule.cardinality === 'many', writeMethods);
  }

  guardWrites(proto, writeMethods, declaration.writeGuards ?? []);

  return { relationshipNames };
}

/** 관계 하나의 라우트를 프로토타입에 만든다. */
function registerRelationship(
  proto: object,
  name: string,
  toMany: boolean,
  writeMethods: string[],
): void {
  const record: Record<string, unknown> = proto as Record<string, unknown>;

  const showName = `showRelationship$${name}`;
  record[showName] = function showRelationship(this: RelationshipDelegates, id: string) {
    return this.showRelationshipFor(name, id);
  };
  decorate(proto, showName, (descriptor) => {
    Get(`:id/relationships/${name}`)(proto, showName, descriptor);
    Param('id')(proto, showName, 0);
  });

  const updateName = `updateRelationship$${name}`;
  record[updateName] = function updateRelationship(
    this: RelationshipDelegates,
    id: string,
    body: unknown,
  ) {
    return this.replaceRelationshipFor(name, id, body);
  };
  decorate(proto, updateName, (descriptor) => {
    Patch(`:id/relationships/${name}`)(proto, updateName, descriptor);
    HttpCode(204)(proto, updateName, descriptor);
    Param('id')(proto, updateName, 0);
    Body()(proto, updateName, 1);
  });
  writeMethods.push(updateName);

  if (toMany) {
    const addName = `addRelationship$${name}`;
    record[addName] = function addRelationship(
      this: RelationshipDelegates,
      id: string,
      body: unknown,
    ) {
      return this.addToRelationshipFor(name, id, body);
    };
    decorate(proto, addName, (descriptor) => {
      Post(`:id/relationships/${name}`)(proto, addName, descriptor);
      HttpCode(204)(proto, addName, descriptor);
      Param('id')(proto, addName, 0);
      Body()(proto, addName, 1);
    });
    writeMethods.push(addName);

    const removeName = `removeRelationship$${name}`;
    record[removeName] = function removeRelationship(
      this: RelationshipDelegates,
      id: string,
      body: unknown,
    ) {
      return this.removeFromRelationshipFor(name, id, body);
    };
    decorate(proto, removeName, (descriptor) => {
      Delete(`:id/relationships/${name}`)(proto, removeName, descriptor);
      HttpCode(204)(proto, removeName, descriptor);
      Param('id')(proto, removeName, 0);
      Body()(proto, removeName, 1);
    });
    writeMethods.push(removeName);
  }

  const relatedName = `showRelated$${name}`;
  record[relatedName] = function showRelated(
    this: RelationshipDelegates,
    id: string,
    query: Readonly<Record<string, string | readonly string[] | undefined>>,
  ) {
    return this.showRelatedFor(name, id, query);
  };
  decorate(proto, relatedName, (descriptor) => {
    Get(`:id/${name}`)(proto, relatedName, descriptor);
    Param('id')(proto, relatedName, 0);
    Query()(proto, relatedName, 1);
  });
}

/**
 * 델리게이트가 호출하는 액션. `crud-actions.ts`의 호스트가 구현한다.
 *
 * 관계마다 라우트 메서드를 따로 만들되 본문은 하나로 모으기 위한 계약이다 — 관계가
 * 늘어도 실제 로직은 이 다섯 개뿐이다.
 */
export interface RelationshipDelegates {
  showRelationshipFor(name: string, id: string): Promise<unknown>;
  replaceRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  addToRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  removeFromRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  showRelatedFor(
    name: string,
    id: string,
    query: Readonly<Record<string, string | readonly string[] | undefined>>,
  ): Promise<unknown>;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/controllers/route-registrar.spec.ts`
Expected: PASS

`registerRoutes`가 `index`/`show`/`create`/`update`/`destroy`를 프로토타입에서 찾지 못해 실패하면, 테스트의 최소 호스트에 그 이름의 빈 메서드를 두어야 한다는 뜻이다. 테스트의 `class Host {}`를 아래로 바꾼다.

```ts
  class Host {
    index(): void {}
    show(): void {}
    create(): void {}
    update(): void {}
    destroy(): void {}
  }
```

(빈 메서드에는 `// eslint-disable-next-line @typescript-eslint/no-empty-function`이 필요할 수 있다. 이 태스크가 검증하는 것은 라우트 등록이지 액션 본문이 아니다.)

- [ ] **Step 5: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`

- [ ] **Step 6: 커밋한다**

```bash
git add src/app/controllers/concerns/route-registrar.ts test/controllers/route-registrar.spec.ts
git commit -m "feat(controllers): 정적 라우트와 관계 라우트 등록기 추가"
```

---
### Task 8: `CrudActions` 조립과 다섯 액션

**Files:**
- Create: `src/app/controllers/concerns/crud-actions.ts`
- Test: 없음(이 태스크는 조립이고, 동작은 Task 10의 wire 테스트가 증명한다). 대신 Step 5의 타입·린트 통과가 게이트다.

**Interfaces:**
- Consumes: 앞선 모든 concern + `parseQuery`/`parseSingleResourceQuery`/`parseRelatedCollectionQuery`/`assertNoQueryParameters`, `executeList`, `serializeResource`/`collectIncluded`, `buildOffsetLinks`/`buildCursorLinks`
- Produces: `function CrudActions<T, C, U>(declaration: CrudDeclaration<T, C, U>): Type<object>`

**왜 이 태스크에 단위 테스트가 없는가:** 여기 있는 것은 이미 각자 테스트된 조각들을 잇는 배선이다. 배선을 흉내로 검증하면 흉내가 맞는지를 검증하게 된다. 실제 계약은 Task 10이 진짜 HTTP와 진짜 PostgreSQL로 확인한다 — 스펙 15장이 "모델 mock, DB 없는 컨트롤러 단위 테스트로 계약을 대체하지 않는다"고 정한 것과 같은 이유다.

- [ ] **Step 1: 구현한다**

`src/app/controllers/concerns/crud-actions.ts`:

```ts
import { Inject, UseGuards } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EntityManager, ObjectLiteral } from 'typeorm';
import { JsonApiError } from '../../jsonapi/errors.js';
import type { HeaderWritableResponse } from '../../jsonapi/media-type.js';
import { JsonApiNegotiationGuard } from '../../jsonapi/negotiation.js';
import {
  buildCursorLinks,
  buildOffsetLinks,
  sliceProbe,
} from '../../jsonapi/pagination.js';
import { executeList } from '../../jsonapi/query-compiler.js';
import {
  assertNoQueryParameters,
  parseQuery,
  parseRelatedCollectionQuery,
  parseSingleResourceQuery,
} from '../../jsonapi/query.js';
import { collectIncluded, serializeResource } from '../../serializers/serializer.js';
import type { ResourceObject } from '../../serializers/serializer.js';
import type { CrudDeclaration } from './crud-base.js';
import {
  collectionDocument,
  singleDocument,
} from './documents.js';
import type { CollectionDocument, LinkageDocument, SingleDocument } from './documents.js';
import { applyAttributes, parseWriteDocument } from './document-parsing.js';
import { assertResourcePath } from './jsonapi-controller.js';
import { resolveOne, resolveRelationships } from './relationship-resolver.js';
import type { ResolvedLinkage } from './relationship-resolver.js';
import { RESOURCE_ALIAS, registerRoutes } from './route-registrar.js';
import type { RelationshipDelegates } from './route-registrar.js';

/**
 * 선언만으로 CRUD와 관계 라우트를 만드는 mixin 팩토리.
 *
 * 컨트롤러에는 선언만 둔다 — 자원별 service 계층을 만들지 않는다는 스펙 4장의 규칙이
 * 여기서 지켜진다. 도메인 개입이 필요하면 `beforeSave`/`afterSave`/`beforeDestroy`
 * 훅을 쓰고, 훅으로 안 되는 자원은 이 mixin을 쓰지 않는 편이 낫다.
 *
 * 팩토리가 만든 클래스에는 `emitDecoratorMetadata`가 `design:paramtypes`를 붙여 주지
 * 않으므로 생성자 주입을 `Inject`로 직접 선언한다(계획의 사전 검증 결과 참고).
 */

type QueryRecord = Readonly<Record<string, string | readonly string[] | undefined>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CrudActions<
  T extends ObjectLiteral & { id: string },
  C extends object,
  U extends object,
>(declaration: CrudDeclaration<T, C, U>): Type<object> {
  const { model, serializer, queryPolicy, relationshipsSchema } = declaration;
  const declaredRelationships = Object.keys(serializer.relationships);

  if (declaration.enableUpsert === true && declaration.replaceSchema === undefined) {
    throw new TypeError('enableUpsert를 켰으면 replaceSchema를 선언해야 한다');
  }

  class CrudActionsHost implements RelationshipDelegates {
    constructor(readonly dataSource: DataSource) {
      // 팩토리 시점에는 `@Controller`가 아직 붙지 않아 비교할 경로가 없다.
      // 생성자로 옮겨 부트스트랩에서 터지게 한다(`jsonapi-controller.ts` 참고).
      assertResourcePath(this.constructor, serializer.resourcePath);
    }

    /** `self` 링크와 `Location`의 기준. 생성자가 이미 존재를 확인했다. */
    private get basePath(): string {
      const path = serializer.resourcePath;
      if (path === undefined) {
        throw new TypeError('resourcePath가 없다');
      }
      return path;
    }

    /**
     * 잘못된 모양의 id를 404로 바꾼다.
     *
     * 기본키가 uuid인데 uuid가 아닌 문자열이 오면 PostgreSQL이 문법 오류를 내고
     * 500이 나간다. 없는 자원을 물은 것이므로 404가 맞는 답이다.
     */
    private assertIdShape(manager: EntityManager, id: string): void {
      const [primary] = manager.connection.getMetadata(model).primaryColumns;
      if (primary?.type === 'uuid' && !UUID_PATTERN.test(id)) {
        throw this.notFound(id);
      }
    }

    private notFound(id: string): JsonApiError {
      return new JsonApiError('RESOURCE_NOT_FOUND', {
        detail: `no "${serializer.type}" resource with id "${id}"`,
      });
    }

    /** 자원 하나를 include와 함께 읽는다. 없으면 404. */
    private async findOne(
      manager: EntityManager,
      id: string,
      include: readonly string[],
    ): Promise<T> {
      this.assertIdShape(manager, id);
      const builder = manager
        .getRepository(model)
        .createQueryBuilder(RESOURCE_ALIAS)
        .where(`${RESOURCE_ALIAS}.id = :id`, { id });
      for (const path of include) {
        const definition = serializer.relationships[path];
        if (definition === undefined) {
          throw new TypeError(`선언되지 않은 관계 경로다: ${path}`);
        }
        builder.leftJoinAndSelect(`${RESOURCE_ALIAS}.${definition.eagerLoad}`, definition.eagerLoad);
      }
      const entity = await builder.getOne();
      if (entity === null) {
        throw this.notFound(id);
      }
      return entity;
    }

    /** 해석을 마친 linkage를 엔티티에 옮긴다. */
    private applyLinkage(entity: T, linkage: ResolvedLinkage): void {
      for (const [name, value] of Object.entries(linkage.toOne)) {
        Reflect.set(entity, name, value);
      }
      for (const [name, value] of Object.entries(linkage.toMany)) {
        Reflect.set(entity, name, value);
      }
    }

    async index(query: QueryRecord): Promise<CollectionDocument> {
      const parsed = parseQuery(query, queryPolicy, declaredRelationships);
      const builder = this.dataSource.getRepository(model).createQueryBuilder(RESOURCE_ALIAS);
      const result = await executeList(builder, RESOURCE_ALIAS, parsed, serializer);
      const data = result.items.map((item) => serializeResource(serializer, item));
      const included = collectIncluded(serializer, result.items, parsed.include);
      const links =
        parsed.page.mode === 'offset'
          ? buildOffsetLinks(this.basePath, query, parsed.page, result.hasMore, result.totalCount)
          : buildCursorLinks(
              this.basePath,
              query,
              parsed.page,
              result.firstCursor,
              result.lastCursor,
              result.hasMore,
            );
      return collectionDocument(data, included, links, result.totalCount);
    }

    async show(id: string, query: QueryRecord): Promise<SingleDocument> {
      const include = parseSingleResourceQuery(query, queryPolicy, declaredRelationships);
      const entity = await this.findOne(this.dataSource.manager, id, include);
      return singleDocument(
        serializeResource(serializer, entity),
        collectIncluded(serializer, [entity], include),
      );
    }

    async create(body: unknown, response: HeaderWritableResponse): Promise<SingleDocument> {
      const parsed = await parseWriteDocument(body, declaration.createSchema, {
        expectedType: serializer.type,
      });

      const saved = await this.dataSource.transaction(async (manager) => {
        const entity = manager.getRepository(model).create();
        applyAttributes(entity, parsed.attributes, parsed.presentKeys);
        this.applyLinkage(
          entity,
          await resolveRelationships(manager, relationshipsSchema, parsed.relationships),
        );
        await declaration.beforeSave?.(entity, manager);
        const stored = await manager.getRepository(model).save(entity);
        await declaration.afterSave?.(stored, manager);
        return stored;
      });

      response.setHeader('Location', `${this.basePath}/${saved.id}`);

      // 저장 뒤에 다시 읽는다. DB 기본값(`status`)과 생성 시각은 저장 시점에야 정해지고,
      // 관계는 요청이 보낸 것만 되읽어 응답의 linkage가 실제 상태와 맞게 한다.
      const reloaded = await this.findOne(
        this.dataSource.manager,
        saved.id,
        Object.keys(parsed.relationships),
      );
      return singleDocument(serializeResource(serializer, reloaded), []);
    }

    async update(id: string, body: unknown): Promise<SingleDocument> {
      const parsed = await parseWriteDocument(body, declaration.updateSchema, {
        expectedType: serializer.type,
        expectedId: id,
      });

      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, Object.keys(parsed.relationships));
        // 보낸 필드만 바꾼다. 스펙 7.1의 부분 갱신이 여기서 지켜진다.
        applyAttributes(entity, parsed.attributes, parsed.presentKeys);
        this.applyLinkage(
          entity,
          await resolveRelationships(manager, relationshipsSchema, parsed.relationships),
        );
        await declaration.beforeSave?.(entity, manager);
        const stored = await manager.getRepository(model).save(entity);
        await declaration.afterSave?.(stored, manager);
      });

      const reloaded = await this.findOne(
        this.dataSource.manager,
        id,
        Object.keys(parsed.relationships),
      );
      return singleDocument(serializeResource(serializer, reloaded), []);
    }

    async destroy(id: string): Promise<void> {
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, []);
        await declaration.beforeDestroy?.(entity, manager);
        await manager.getRepository(model).remove(entity);
      });
    }

    /** 관계 규칙을 꺼낸다. 라우트가 있는 관계는 반드시 규칙이 있다. */
    private ruleFor(name: string): (typeof relationshipsSchema)[string] {
      const rule = relationshipsSchema[name];
      if (rule === undefined) {
        throw new TypeError(`쓰기로 열리지 않은 관계다: ${name}`);
      }
      return rule;
    }

    private linkageLinks(id: string, name: string): { self: string; related: string } {
      return {
        self: `${this.basePath}/${id}/relationships/${name}`,
        related: `${this.basePath}/${id}/${name}`,
      };
    }

    async showRelationshipFor(name: string, id: string): Promise<LinkageDocument> {
      const entity = await this.findOne(this.dataSource.manager, id, [name]);
      const object = serializeResource(serializer, entity);
      const relationship = object.relationships[name];
      if (relationship === undefined) {
        throw new TypeError(`시리얼라이저가 선언하지 않은 관계다: ${name}`);
      }
      return { data: relationship.data ?? null, links: this.linkageLinks(id, name) };
    }

    async replaceRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const resolved = await resolveOne(manager, rule, { data: readData(body) }, '/data');
        Reflect.set(entity, name, resolved);
        await manager.getRepository(model).save(entity);
      });
    }

    async addToRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const incoming = await resolveOne(manager, rule, { data: readData(body) }, '/data');
        if (!Array.isArray(incoming)) {
          throw new TypeError(`to-many 관계가 아니다: ${name}`);
        }
        const current: unknown = Reflect.get(entity, name);
        const existing: ObjectLiteral[] = Array.isArray(current) ? current : [];
        const merged = [...existing];
        for (const row of incoming) {
          if (!merged.some((entry) => entry.id === row.id)) {
            merged.push(row);
          }
        }
        Reflect.set(entity, name, merged);
        await manager.getRepository(model).save(entity);
      });
    }

    async removeFromRelationshipFor(name: string, id: string, body: unknown): Promise<void> {
      const rule = this.ruleFor(name);
      await this.dataSource.transaction(async (manager) => {
        const entity = await this.findOne(manager, id, [name]);
        const outgoing = await resolveOne(manager, rule, { data: readData(body) }, '/data');
        if (!Array.isArray(outgoing)) {
          throw new TypeError(`to-many 관계가 아니다: ${name}`);
        }
        const removed = new Set(outgoing.map((row) => row.id));
        const current: unknown = Reflect.get(entity, name);
        const existing: ObjectLiteral[] = Array.isArray(current) ? current : [];
        Reflect.set(
          entity,
          name,
          existing.filter((entry) => !removed.has(entry.id)),
        );
        await manager.getRepository(model).save(entity);
      });
    }

    async showRelatedFor(name: string, id: string, query: QueryRecord): Promise<unknown> {
      const rule = this.ruleFor(name);
      const entity = await this.findOne(this.dataSource.manager, id, [name]);
      const definition = serializer.relationships[name];
      if (definition === undefined) {
        throw new TypeError(`시리얼라이저가 선언하지 않은 관계다: ${name}`);
      }
      const target = definition.target();
      const value: unknown = definition.read(entity);

      if (rule.cardinality === 'one') {
        // 스펙 8.2: to-one 관계 URL은 모든 조회 파라미터를 거부한다.
        assertNoQueryParameters(query);
        if (value === null || value === undefined) {
          return { data: null };
        }
        return { data: target.serializeUnknown(value) };
      }

      // 스펙 8.2: to-many는 `page[number]`/`page[size]`만 받고 총 개수를 언제나 낸다.
      const page = parseRelatedCollectionQuery(query, queryPolicy);
      const rows: unknown[] = Array.isArray(value) ? value : [];
      // 관계 컬렉션은 한 자원에 매달린 것이라 크기가 제한적이다. 별도 질의로 자르는
      // 대신 이미 읽어 온 배열에서 자른다 — 조인 한 번으로 끝나고 총 개수도 공짜다.
      const start = ((page.number ?? 1) - 1) * page.size;
      const windowed = rows.slice(start, start + page.size + 1);
      const probed = sliceProbe(windowed, page);
      const data: ResourceObject[] = probed.items.map((row) => target.serializeUnknown(row));
      const links = buildOffsetLinks(
        `${this.basePath}/${id}/${name}`,
        query,
        page,
        probed.hasMore,
        rows.length,
      );
      return collectionDocument(data, [], links, rows.length);
    }
  }

  Inject(getDataSourceToken())(CrudActionsHost, undefined, 0);
  // 협상 가드는 클래스 전체에 붙는다 — 이 컨트롤러의 모든 라우트가 JSON:API다.
  UseGuards(JsonApiNegotiationGuard)(CrudActionsHost);
  registerRoutes(CrudActionsHost, declaration);

  return CrudActionsHost;
}

/** 관계 라우트 본문에서 `data` 멤버를 꺼낸다. 없으면 문서 오류다. */
function readData(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new JsonApiError('INVALID_JSONAPI_DOCUMENT', {
      source: { pointer: '/data' },
      detail: 'the document requires a "data" member',
    });
  }
  return Reflect.get(body, 'data');
}
```

- [ ] **Step 2: 타입을 확인한다**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 통과

막히기 쉬운 곳 셋:
1. `manager.getRepository(model).create()`가 `T`가 아니라 `DeepPartial<T>`를 요구하면 인자 없이 부른다(`create()`는 빈 엔티티를 만든다).
2. `Reflect.get`은 `any`를 돌려준다. 반드시 `const value: unknown = Reflect.get(...)`로 받아 `any`가 번지지 않게 한다.
3. `(typeof relationshipsSchema)[string]`가 `RelationshipWriteRule | undefined`로 잡히면 `RelationshipWriteRule`을 직접 import해 반환 타입으로 쓴다.

- [ ] **Step 3: 린트를 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check .`

- [ ] **Step 4: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `./scripts/check.sh`
Expected: exit 0. 이 태스크는 아직 어떤 컨트롤러도 등록하지 않으므로 기존 테스트는 그대로 통과해야 한다. 커버리지 게이트가 새 파일 때문에 내려가면 Task 10의 wire 테스트가 올린다 — 이 태스크에서 게이트가 깨지면 그 사실을 보고하고 Task 10까지 함께 진행할지 물어본다.

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/controllers/concerns/crud-actions.ts
git commit -m "feat(controllers): CrudActions 조립과 다섯 액션·관계 델리게이트 추가"
```

---
### Task 9: HTTP 조립과 Example 컨트롤러 등록

**Files:**
- Create: `src/config/http.ts`
- Create: `src/app/controllers/api/v1/examples.controller.ts`
- Modify: `src/config/main.ts`, `src/config/routes.module.ts`, `test/app-factory.ts`
- Test: `test/config/http.spec.ts`

**Interfaces:**
- Produces: `function configureHttp(app: NestExpressApplication): void`; `class ExamplesController`

**사전 검증 결과 (계획 작성 중 실측 — 이 태스크의 핵심):**

`app.useBodyParser('json', { type: 'application/vnd.api+json' })`는 기본 JSON 파서를 **더하는 것이 아니라 교체한다.** 벤더 타입만 넘기면 그 타입은 파싱되지만 `application/json` 본문이 통째로 `{}`가 된다(폐기용 프로브로 확인). 두 타입을 함께 넘겨야 한다.

```ts
app.useBodyParser('json', { type: ['application/json', JSONAPI_MEDIA_TYPE] });
```

이 저장소는 지금 JSON:API 아닌 본문을 받는 라우트가 없지만, 기본 파서를 조용히 죽여 두면 그런 라우트를 처음 추가하는 사람이 원인을 찾는 데 오래 걸린다.

**왜 `src/config/http.ts`인가:** 이 설정은 프로덕션 진입점(`main.ts`)과 테스트 팩토리(`test/app-factory.ts`) **양쪽**에 필요하다. 두 곳에 각자 쓰면 갈라진다 — 스펙 15장이 "애플리케이션 조립은 한 곳"이라고 정한 것과 같은 이유로 한 함수가 소유한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/config/http.spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';

describe('HTTP 조립', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('vendor 미디어 타입 본문을 파싱한다', async () => {
    // 파싱되지 않으면 본문이 `{}`가 되어 "type이 없다"는 400이 나간다.
    // 여기서 400 INVALID_JSONAPI_DOCUMENT가 아니라 TYPE_MISMATCH가 나오는 것이
    // 본문이 실제로 읽혔다는 증거다.
    const response = await request(app.getHttpServer())
      .post('/api/v1/examples')
      .set('Accept', 'application/vnd.api+json')
      .set('Content-Type', 'application/vnd.api+json')
      .send(JSON.stringify({ data: { type: 'others', attributes: { title: '제목' } } }));

    const body = response.body as { errors: { code: string }[] };
    expect(body.errors[0]?.code).toBe('TYPE_MISMATCH');
  });

  it('기본 JSON 파서를 죽이지 않는다', () => {
    // `useBodyParser`는 기본 파서를 교체한다(실측). 두 타입을 함께 넘기지 않으면
    // application/json 본문이 조용히 `{}`가 된다.
    const instance = app.getHttpAdapter().getInstance() as { get(name: string): unknown };
    expect(instance.get('query parser')).toBe('simple');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `./scripts/check.sh`
Expected: FAIL — `/api/v1/examples` 라우트가 없어 404

- [ ] **Step 3: HTTP 조립을 만든다**

`src/config/http.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JSONAPI_MEDIA_TYPE } from '../app/jsonapi/media-type.js';

/**
 * 프로덕션과 테스트가 함께 쓰는 HTTP 계층 설정.
 *
 * 두 진입점(`main.ts`, `test/app-factory.ts`)이 각자 설정하면 갈라진다 — 그러면
 * 테스트가 통과하는 앱과 배포되는 앱이 달라진다.
 */
export function configureHttp(app: NestExpressApplication): void {
  // `useBodyParser`는 기본 JSON 파서를 **교체한다**(실측). 벤더 타입만 넘기면
  // `application/json` 본문이 통째로 `{}`가 된다. 지금은 JSON:API 아닌 본문을 받는
  // 라우트가 없지만, 기본 파서를 조용히 죽여 두면 그런 라우트를 처음 추가하는 사람이
  // 원인을 찾는 데 오래 걸린다.
  app.useBodyParser('json', { type: ['application/json', JSONAPI_MEDIA_TYPE] });

  // Express 5의 기본값과 같지만 명시한다. `src/app/jsonapi/`의 파서들이 대괄호를
  // 그대로 가진 평평한 질의 객체를 전제로 쓰여 있고, 이 값이 `extended`로 바뀌면
  // 그 전제가 조용히 무너진다.
  app.getHttpAdapter().getInstance().set('query parser', 'simple');
}
```

- [ ] **Step 4: 컨트롤러를 선언한다**

`src/app/controllers/api/v1/examples.controller.ts`:

```ts
import { Controller } from '@nestjs/common';
import { CrudActions } from '../../concerns/crud-actions.js';
import { Example } from '../../../models/example.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../../schemas/example.query-policy.js';
import {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleUpdate,
} from '../../../schemas/example.schemas.js';
import { EXAMPLE_SERIALIZER } from '../../../serializers/example.serializer.js';

/**
 * Example 자원.
 *
 * 이 파일에는 선언만 있다 — 모델·시리얼라이저·쓰기 스키마·조회 정책이 전부이고
 * CRUD 구현은 `CrudActions`가 소유한다. 자원별 service 계층을 만들지 않는다는
 * 스펙 4장의 규칙이 여기서 눈에 보인다.
 *
 * `@Controller` 경로는 시리얼라이저의 `resourcePath`와 문자열까지 같아야 한다.
 * 어긋나면 부트스트랩에서 터진다(`jsonapi-controller.ts` 참고).
 *
 * `writeGuards`는 아직 비어 있다. 스펙 16장은 쓰기에 활성 사용자의 Bearer 토큰을
 * 요구하는데, 그 가드는 Phase 6이 만든다 — 없는 가드를 미리 적어 두면 지금 부팅이
 * 안 된다.
 */
@Controller('api/v1/examples')
export class ExamplesController extends CrudActions({
  model: Example,
  serializer: EXAMPLE_SERIALIZER,
  createSchema: ExampleCreate,
  updateSchema: ExampleUpdate,
  relationshipsSchema: EXAMPLE_RELATIONSHIPS,
  queryPolicy: EXAMPLE_QUERY_POLICY,
}) {}
```

- [ ] **Step 5: 배선한다**

`src/config/routes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ExamplesController } from '../app/controllers/api/v1/examples.controller.js';
import { HealthController } from '../app/controllers/health.controller.js';

/**
 * 공개 라우트의 유일한 등록 지점.
 *
 * 컨트롤러 자동 탐색을 추가하지 않는다. 아래 배열에 없는 컨트롤러는 존재하지 않는 것과 같다.
 */
@Module({
  controllers: [HealthController, ExamplesController],
})
export class RoutesModule {}
```

`src/config/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './http.js';
import { setupOpenApi } from './openapi.js';
import { loadServerSettings } from './settings.js';

async function bootstrap(): Promise<void> {
  const settings = loadServerSettings();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttp(app);
  setupOpenApi(app);
  await app.listen(settings.port, '0.0.0.0');
}

await bootstrap();
```

`test/app-factory.ts`의 `createTestApp`을 고친다.

```ts
export async function createTestApp(): Promise<INestApplication<Server>> {
  useTestDatabase();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttp(app);
  setupOpenApi(app);
  await app.init();
  return app;
}
```

(import에 `configureHttp`와 `NestExpressApplication` 타입을 더한다. 반환 타입은 `INestApplication<Server>` 그대로 둔다 — 호출하는 쪽이 서버 타입만 알면 되고, `NestExpressApplication`은 조립 지점의 사정이다.)

- [ ] **Step 6: 라우트 계약 테스트를 갱신한다**

`test/config/routes.module.spec.ts`의 기대 목록을 스펙 16장의 전체 표면으로 넓힌다.

```ts
  it('RoutesModule에 등록한 라우트만 노출한다', () => {
    expect(registeredRoutes(app)).toEqual([
      'DELETE /api/v1/examples/:id',
      'DELETE /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples',
      'GET /api/v1/examples/:id',
      'GET /api/v1/examples/:id/category',
      'GET /api/v1/examples/:id/relationships/category',
      'GET /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples/:id/tags',
      'GET /health/live',
      'GET /health/ready',
      'PATCH /api/v1/examples/:id',
      'PATCH /api/v1/examples/:id/relationships/category',
      'PATCH /api/v1/examples/:id/relationships/tags',
      'POST /api/v1/examples',
      'POST /api/v1/examples/:id/relationships/tags',
    ]);
  });
```

`test/config/openapi.spec.ts`의 "명시적으로 조립한 라우트만 문서에 나온다"도 같은 경로들이 나오도록 넓힌다. OpenAPI는 `:id`가 아니라 `{id}`로 적으므로 기대값을 그 표기로 쓴다.

- [ ] **Step 7: 전체 게이트를 돌린다**

Run: `./scripts/check.sh`
Expected: exit 0

- [ ] **Step 8: 커밋한다**

```bash
git add src/config/http.ts src/config/main.ts src/config/routes.module.ts src/app/controllers/api/v1 test/app-factory.ts test/config
git commit -m "feat(config): Example 컨트롤러 등록과 vendor 본문 파서 배선"
```

---

### Task 10: 실제 HTTP와 PostgreSQL로 계약 고정

**Files:**
- Create: `test/integration/examples-api.spec.ts`

**왜 이 태스크가 Phase 4의 증거인가:** 앞선 아홉 태스크는 조각을 만들었고 그 조각들은 각자 테스트됐다. 이 태스크만이 "선언 하나로 라우트가 생기고 실제 요청이 실제 DB를 바꾼다"를 증명한다. 스펙 15장이 "모델 mock, DB 없는 컨트롤러 단위 테스트로 계약을 대체하지 않는다"고 정한 자리다.

**정리 방식 — `TRUNCATE`가 아니라 `DELETE`를 쓴다.** 이 스위트는 실제 HTTP를 거치므로 트랜잭션 롤백으로 격리할 수 없고 행을 커밋한다. `TRUNCATE`는 `ACCESS EXCLUSIVE` 잠금을 잡아 같은 DB를 쓰는 다른 Jest 워커의 읽기까지 막고, 여러 테이블을 한 번에 잠그므로 교착 가능성도 생긴다. `DELETE`는 행 수준 잠금만 잡고, 다른 워커의 커밋되지 않은 행은 MVCC 때문에 애초에 보이지 않아 지워지지도 않는다.

- [ ] **Step 1: 테스트를 쓴다**

`test/integration/examples-api.spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';

const VENDOR = 'application/vnd.api+json';
const MISSING = '0195c1a0-0000-7000-8000-0000000009ff';

interface ErrorBody {
  errors: { code: string; status: string; title: string; source?: { pointer?: string } }[];
}

interface ResourceBody {
  data: {
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data?: unknown }>;
    links: { self: string };
  };
  included?: { type: string; id: string }[];
}

interface CollectionBody {
  data: { id: string; attributes: Record<string, unknown> }[];
  links: { self: string; next?: string; last?: string };
  meta?: { totalCount: number };
}

describe('Examples API', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;

  const api = () => request(app.getHttpServer());

  /** JSON:API 헤더를 갖춘 POST. */
  async function createExample(attributes: Record<string, unknown>, relationships?: unknown) {
    return api()
      .post('/api/v1/examples')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: { type: 'examples', attributes, ...(relationships === undefined ? {} : { relationships }) },
        }),
      );
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterEach(async () => {
    // TRUNCATE가 아니라 DELETE다 — 행 수준 잠금만 잡아 다른 워커를 막지 않고,
    // 커밋되지 않은 다른 워커의 행은 보이지 않아 지워지지도 않는다.
    await dataSource.query('DELETE FROM example_tags');
    await dataSource.query('DELETE FROM examples');
    await dataSource.query('DELETE FROM categories');
    await dataSource.query('DELETE FROM tags');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/examples', () => {
    it('201과 Location, 그리고 자원 문서를 낸다', async () => {
      const response = await createExample({ title: '제목' });

      expect(response.status).toBe(201);
      expect(response.headers['content-type']).toBe(VENDOR);
      const body = response.body as ResourceBody;
      expect(response.headers.location).toBe(`/api/v1/examples/${body.data.id}`);
      expect(body.data.type).toBe('examples');
      expect(body.data.attributes.title).toBe('제목');
      // DB 기본값이 응답에 반영돼야 한다.
      expect(body.data.attributes.status).toBe('draft');
      expect(body.data.links.self).toBe(`/api/v1/examples/${body.data.id}`);
    });

    it('검증 실패를 422로, 틀린 필드를 모두 낸다', async () => {
      const response = await createExample({ title: '', status: 'unknown' });

      expect(response.status).toBe(422);
      const body = response.body as ErrorBody;
      expect(body.errors).toHaveLength(2);
      expect(body.errors.map((error) => error.source?.pointer).sort()).toEqual([
        '/data/attributes/status',
        '/data/attributes/title',
      ]);
    });

    it('타입이 다르면 409 TYPE_MISMATCH다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'others', attributes: { title: '제목' } } }));

      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('TYPE_MISMATCH');
    });

    it('클라이언트가 만든 id를 403으로 거부한다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(
          JSON.stringify({
            data: { type: 'examples', id: MISSING, attributes: { title: '제목' } },
          }),
        );

      expect(response.status).toBe(403);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('CLIENT_GENERATED_ID_UNSUPPORTED');
    });

    it('관계를 함께 만든다', async () => {
      const category = await dataSource.query<{ id: string }[]>(
        `INSERT INTO categories (name) VALUES ('분류') RETURNING id`,
      );
      const categoryId = category[0]?.id;
      if (categoryId === undefined) {
        throw new Error('분류를 만들지 못했다');
      }

      const response = await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: categoryId } } },
      );

      expect(response.status).toBe(201);
      expect((response.body as ResourceBody).data.relationships.category?.data).toEqual({
        type: 'categories',
        id: categoryId,
      });
    });

    it('없는 관계 대상은 404 RELATIONSHIP_RESOURCE_NOT_FOUND다', async () => {
      const response = await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: MISSING } } },
      );

      expect(response.status).toBe(404);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('RELATIONSHIP_RESOURCE_NOT_FOUND');
    });

    it('관계 대상을 못 찾으면 자원도 만들지 않는다', async () => {
      // 트랜잭션이 실제로 걸려 있는지 확인한다. 자원만 남고 관계가 비면
      // 클라이언트가 만든 적 없는 자원이 생긴다.
      await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: MISSING } } },
      );
      const rows = await dataSource.query<{ count: string }[]>('SELECT COUNT(*) FROM examples');
      expect(rows[0]?.count).toBe('0');
    });
  });

  describe('GET /api/v1/examples', () => {
    it('빈 컬렉션도 data가 배열이다', async () => {
      const response = await api().get('/api/v1/examples').set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as CollectionBody).data).toEqual([]);
    });

    it('목록과 페이지 링크를 낸다', async () => {
      await createExample({ title: 'ㄱ' });
      await createExample({ title: 'ㄴ' });

      const response = await api().get('/api/v1/examples?page[size]=1').set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.data).toHaveLength(1);
      expect(body.links.next).toContain('page[number]=2');
      expect(body.meta).toBeUndefined();
    });

    it('totals를 요청하면 총 개수와 last 링크를 낸다', async () => {
      await createExample({ title: 'ㄱ' });
      await createExample({ title: 'ㄴ' });

      const response = await api()
        .get('/api/v1/examples?page[size]=1&page[totals]=true')
        .set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.meta?.totalCount).toBe(2);
      expect(body.links.last).toContain('page[number]=2');
    });

    it('filter와 sort를 적용한다', async () => {
      await createExample({ title: 'ㄱ', status: 'published' });
      await createExample({ title: 'ㄴ' });

      const response = await api()
        .get('/api/v1/examples?filter[status]=published&sort=title')
        .set('Accept', VENDOR);
      const body = response.body as CollectionBody;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.attributes.title).toBe('ㄱ');
    });

    it('알 수 없는 질의 파라미터를 400으로 거부한다', async () => {
      const response = await api().get('/api/v1/examples?q=검색').set('Accept', VENDOR);
      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('GET /api/v1/examples/{id}', () => {
    it('자원 하나를 낸다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api().get(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as ResourceBody).data.id).toBe(id);
    });

    it('include로 관계 자원을 함께 낸다', async () => {
      const category = await dataSource.query<{ id: string }[]>(
        `INSERT INTO categories (name) VALUES ('분류') RETURNING id`,
      );
      const categoryId = category[0]?.id;
      if (categoryId === undefined) {
        throw new Error('분류를 만들지 못했다');
      }
      const created = await createExample(
        { title: '제목' },
        { category: { data: { type: 'categories', id: categoryId } } },
      );
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}?include=category`)
        .set('Accept', VENDOR);
      expect(response.body as ResourceBody).toHaveProperty('included');
      expect((response.body as ResourceBody).included?.[0]?.type).toBe('categories');
    });

    it('없는 자원은 404다', async () => {
      const response = await api().get(`/api/v1/examples/${MISSING}`).set('Accept', VENDOR);
      expect(response.status).toBe(404);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('모양이 깨진 id도 404다', async () => {
      // uuid 컬럼에 uuid가 아닌 값을 넣으면 드라이버가 문법 오류를 낸다. 없는 자원을
      // 물은 것이므로 500이 아니라 404가 맞다.
      const response = await api().get('/api/v1/examples/not-a-uuid').set('Accept', VENDOR);
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/examples/{id}', () => {
    it('보낸 필드만 바꾼다', async () => {
      const created = await createExample({ title: '제목', body: '본문' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'examples', id, attributes: { title: '새 제목' } } }));

      expect(response.status).toBe(200);
      const body = response.body as ResourceBody;
      expect(body.data.attributes.title).toBe('새 제목');
      // 보내지 않은 필드는 그대로여야 한다. 이것이 스펙 7.1의 계약이다.
      expect(body.data.attributes.body).toBe('본문');
    });

    it('null로 보낸 필드는 비운다', async () => {
      const created = await createExample({ title: '제목', body: '본문' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'examples', id, attributes: { body: null } } }));

      expect((response.body as ResourceBody).data.attributes.body).toBeNull();
    });

    it('경로와 문서의 id가 다르면 409 ID_MISMATCH다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .patch(`/api/v1/examples/${id}`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'examples', id: MISSING, attributes: {} } }));

      expect(response.status).toBe(409);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('ID_MISMATCH');
    });
  });

  describe('DELETE /api/v1/examples/{id}', () => {
    it('204를 내고 실제로 지운다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api().delete(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(response.status).toBe(204);

      const after = await api().get(`/api/v1/examples/${id}`).set('Accept', VENDOR);
      expect(after.status).toBe(404);
    });
  });

  describe('관계 라우트', () => {
    async function seedTags(): Promise<string[]> {
      const rows = await dataSource.query<{ id: string }[]>(
        `INSERT INTO tags (name) VALUES ('ㄱ'), ('ㄴ') RETURNING id`,
      );
      return rows.map((row) => row.id);
    }

    it('to-many linkage를 읽는다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect(response.status).toBe(200);
      expect((response.body as { data: unknown[] }).data).toEqual([]);
    });

    it('to-many linkage를 교체하고 204를 낸다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();

      const response = await api()
        .patch(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: tags.map((tagId) => ({ type: 'tags', id: tagId })) }));

      expect(response.status).toBe(204);
      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('to-many에 더하고 뺀다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();
      const [first, second] = tags;
      if (first === undefined || second === undefined) {
        throw new Error('라벨을 만들지 못했다');
      }

      await api()
        .post(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: [{ type: 'tags', id: first }] }))
        .expect(204);

      await api()
        .delete(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: [{ type: 'tags', id: first }] }))
        .expect(204);

      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown[] }).data).toEqual([]);
    });

    it('to-one linkage를 교체하고 해제한다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const category = await dataSource.query<{ id: string }[]>(
        `INSERT INTO categories (name) VALUES ('분류') RETURNING id`,
      );
      const categoryId = category[0]?.id;
      if (categoryId === undefined) {
        throw new Error('분류를 만들지 못했다');
      }

      await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: { type: 'categories', id: categoryId } }))
        .expect(204);

      await api()
        .patch(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: null }))
        .expect(204);

      const after = await api()
        .get(`/api/v1/examples/${id}/relationships/category`)
        .set('Accept', VENDOR);
      expect((after.body as { data: unknown }).data).toBeNull();
    });

    it('related 자원 경로가 연결된 자원을 낸다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;
      const tags = await seedTags();
      await api()
        .patch(`/api/v1/examples/${id}/relationships/tags`)
        .set('Accept', VENDOR)
        .set('Content-Type', VENDOR)
        .send(JSON.stringify({ data: tags.map((tagId) => ({ type: 'tags', id: tagId })) }))
        .expect(204);

      const response = await api().get(`/api/v1/examples/${id}/tags`).set('Accept', VENDOR);
      expect(response.status).toBe(200);
      const body = response.body as CollectionBody;
      expect(body.data).toHaveLength(2);
      // 스펙 8.2: to-many 관계 URL은 총 개수를 언제나 낸다.
      expect(body.meta?.totalCount).toBe(2);
    });

    it('to-one related 경로는 조회 파라미터를 거부한다', async () => {
      const created = await createExample({ title: '제목' });
      const id = (created.body as ResourceBody).data.id;

      const response = await api()
        .get(`/api/v1/examples/${id}/category?include=x`)
        .set('Accept', VENDOR);
      expect(response.status).toBe(400);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('협상', () => {
    it('Accept가 맞지 않으면 406이다', async () => {
      const response = await api().get('/api/v1/examples').set('Accept', 'text/html');
      expect(response.status).toBe(406);
      expect((response.body as ErrorBody).errors[0]?.code).toBe('NOT_ACCEPTABLE');
    });

    it('Content-Type이 맞지 않으면 415다', async () => {
      const response = await api()
        .post('/api/v1/examples')
        .set('Accept', VENDOR)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ data: { type: 'examples', attributes: { title: '제목' } } }));
      expect(response.status).toBe(415);
    });

    it('오류도 vendor Content-Type으로 나간다', async () => {
      const response = await api().get(`/api/v1/examples/${MISSING}`).set('Accept', VENDOR);
      expect(response.headers['content-type']).toBe(VENDOR);
    });

    it('Accept-Language를 따라 오류 메시지가 바뀐다', async () => {
      const korean = await api().get(`/api/v1/examples/${MISSING}`).set('Accept', VENDOR);
      const english = await api()
        .get(`/api/v1/examples/${MISSING}`)
        .set('Accept', VENDOR)
        .set('Accept-Language', 'en');
      expect((korean.body as ErrorBody).errors[0]?.title).not.toBe(
        (english.body as ErrorBody).errors[0]?.title,
      );
    });
  });
});
```

- [ ] **Step 2: 전체 게이트를 돌린다**

Run: `./scripts/check.sh`
Expected: exit 0

실패하면 대개 이 셋 중 하나다.
1. 본문이 `{}`로 온다 → `configureHttp`가 호출되지 않았거나 두 미디어 타입을 함께 넘기지 않았다.
2. 관계 저장이 안 된다 → `save()`에 관계 배열을 실었는지, 조인 테이블이 실제로 갱신되는지 SQL 로그로 확인한다.
3. `Location`이 없다 → `Res({ passthrough: true })` 파라미터 인덱스가 `create`의 두 번째 인자와 맞는지 확인한다.

- [ ] **Step 3: 커밋한다**

```bash
git add test/integration/examples-api.spec.ts
git commit -m "test(integration): Example API 계약을 실제 HTTP와 PostgreSQL로 고정"
```

---

## 마무리

- [ ] **README를 갱신한다**

`## 구조`에 두 줄을 더한다.

```text
src/app/controllers/concerns/  # CrudActions mixin과 하위 책임 분할
src/app/controllers/api/v1/    # 리소스 선언
```

`## 로컬 실행` 아래에 API 예시 절을 더하고, Phase 설명을 `Phase 0-4`로 고친 뒤 미구현 목록에서 "선언형 CRUD"를 뺀다.

- [ ] **커밋한다**

```bash
git add README.md
git commit -m "docs: Phase 4 구조와 진행 상태를 README에 반영"
```
