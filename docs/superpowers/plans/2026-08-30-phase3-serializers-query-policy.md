# Phase 3: 시리얼라이저와 조회 정책 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자원의 공개 표현(시리얼라이저)과 조회 정책(`QueryPolicy`), 그리고 그 둘을 TypeORM `SelectQueryBuilder`로 컴파일하는 질의 계층 + 페이지네이션 2종을 만든다.

**Architecture:** `serializers/`가 JSON:API `type`·attributes·relationships·eager-load 선언을 소유하고, `schemas/`가 filter·sort·include allowlist를 소유한다. `jsonapi/`의 파서들이 요청 질의 문자열을 그 두 선언에 대조해 검증하고, 컴파일러가 `SelectQueryBuilder`에 적용한다. 파싱·검증(순수 함수)과 SQL 적용(컴파일러)을 갈라 두어, 규칙은 DB 없이 단위 테스트로 고정하고 SQL 의미는 실제 PostgreSQL 통합 테스트로 고정한다.

**Tech Stack:** TypeScript 6.0.3(ESM, `strict` + `noUncheckedIndexedAccess`), NestJS 12, TypeORM 1.1.0, PostgreSQL 18, Jest 30

**Spec:** `docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md` (특히 4장 계층 소유권, 8장 조회 정책, 15장 테스트 전략)

## Global Constraints

- 모든 상대 import에 `.js` 확장자를 붙인다. 빠뜨리면 `tsc`가 `TS2835`로 거부한다.
- `noUncheckedIndexedAccess`가 켜져 있다. `arr[0]`과 `record[key]`는 `T | undefined`다. `!`나 `as`로 지우지 말고 실제 분기로 좁힌다.
- 컴파일러를 침묵시키는 `as` 캐스트를 쓰지 않는다. 좁혀야 하면 타입 프레디케이트나 `instanceof` 분기를 쓴다.
- ESLint는 `strictTypeChecked` + `stylisticTypeChecked`다. `any`가 흘러나오는 표현은 전부 오류다.
- 함수 선언에는 명시적 반환 타입을 붙인다(`allowExpressions: true`이므로 콜백은 예외).
- 오류는 `JsonApiError`만 던진다. 코드는 `src/app/jsonapi/errors.ts`의 24개 카탈로그에서 고른다. 새 코드를 늘리지 않는다.
- 사용자 입력으로 SQL 열 이름을 조합하지 않는다. 열 이름은 항상 선언된 allowlist에서만 나온다.
- 한 페이지 최대 100개다.
- 목록 응답은 COUNT를 기본 실행하지 않는다. 다음 페이지 존재 여부는 한 행 더 읽어(probe) 판정한다.
- 주석과 테스트 이름은 한국어로 쓴다. 기존 파일의 밀도와 어조를 따른다.
- 모든 단계가 끝나면 `./scripts/check.sh`가 통과해야 한다(커버리지 게이트 80%).

---

## 이 계획이 만드는 파일

| 경로 | 책임 |
| --- | --- |
| `src/app/serializers/serializer.ts` | 시리얼라이저 선언 타입과 자원 직렬화·`included` 수집 |
| `src/app/serializers/category.serializer.ts` | Category의 공개 표현 |
| `src/app/serializers/tag.serializer.ts` | Tag의 공개 표현 |
| `src/app/serializers/example.serializer.ts` | Example의 공개 표현과 관계 선언 |
| `src/app/serializers/index.ts` | 시리얼라이저 명시 등록 |
| `src/app/schemas/query-policy.ts` | `QueryPolicy` 선언 타입과 연산자 목록 |
| `src/app/schemas/example.query-policy.ts` | Example의 filter·sort·include allowlist |
| `src/app/schemas/index.ts` | 정책 명시 등록 |
| `src/app/jsonapi/filter.ts` | `filter[...]` 파싱과 저장 형식 변환 |
| `src/app/jsonapi/sort.ts` | `sort` 파싱과 tie breaker 부착 |
| `src/app/jsonapi/include.ts` | `include` 파싱 (시리얼라이저 ∩ 정책) |
| `src/app/jsonapi/cursor.ts` | keyset 커서 인코딩·디코딩 |
| `src/app/jsonapi/pagination.ts` | `page[...]` 파싱, offset·cursor 모드, 링크 생성 |
| `src/app/jsonapi/query.ts` | 질의 파라미터 전체 검증과 조립 |
| `src/app/jsonapi/query-compiler.ts` | `SelectQueryBuilder`로의 컴파일과 실행 |

테스트는 `test/serializers/`, `test/schemas/`, `test/jsonapi/`, `test/integration/`에 대응해 둔다.

---

### Task 1: 시리얼라이저 선언 타입과 자원 직렬화

**Files:**
- Create: `src/app/serializers/serializer.ts`
- Test: `test/serializers/serializer.spec.ts`

**Interfaces:**
- Consumes: `ResourceIdentifier` (`src/app/jsonapi/document.ts`)
- Produces:
  - `type RelationshipCardinality = 'one' | 'many'`
  - `interface RelationshipObject { links?: { self: string; related: string }; data?: ResourceIdentifier | readonly ResourceIdentifier[] | null }`
  - `interface ResourceObject { type: string; id: string; attributes: Record<string, unknown>; relationships: Record<string, RelationshipObject>; links?: { self: string } }`
  - `interface ErasedSerializer { type: string; resourcePath?: string; serializeUnknown(entity: unknown): ResourceObject }`
  - `interface RelationshipDefinition<T> { cardinality: RelationshipCardinality; eagerLoad: string; read: (entity: T) => unknown; target: () => ErasedSerializer }`
  - `interface ResourceSerializer<T extends { id: string }> { type: string; resourcePath?: string; attributes: Readonly<Record<string, (entity: T) => unknown>>; relationships: Readonly<Record<string, RelationshipDefinition<T>>> }`

**설계 근거 — `resourcePath`가 선택인 이유:** 스펙 16장의 공개 API 표면에는 `/api/v1/examples` 계열만 있고 `categories`·`tags`를 단건으로 여는 라우트는 없다. 그런데도 모든 자원에 `self` 링크를 붙이면 `included`에 실린 Category가 존재하지 않는 URL을 가리키게 된다 — 클라이언트가 따라가면 404다. JSON:API에서 `links`는 선택 멤버이므로, 라우트가 없는 자원은 링크를 아예 내지 않는 쪽이 정직하다. 관계의 `related` 링크(`/api/v1/examples/{id}/category`)는 **부모**의 경로로 만들어지므로 그대로 살아 있다.
  - `function serializeResource<T extends { id: string }>(serializer: ResourceSerializer<T>, entity: T): ResourceObject`
  - `function collectIncluded<T extends { id: string }>(serializer: ResourceSerializer<T>, entities: readonly T[], includePaths: readonly string[]): ResourceObject[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/serializers/serializer.spec.ts`를 만든다.

```ts
import { collectIncluded, serializeResource } from '../../src/app/serializers/serializer.js';
import type { ErasedSerializer, ResourceSerializer } from '../../src/app/serializers/serializer.js';

interface Author {
  id: string;
  name: string;
}

interface Post {
  id: string;
  title: string;
  createdAt: Date;
  author?: Author | null;
  reviewers?: Author[];
}

const AUTHOR_SERIALIZER: ResourceSerializer<Author> = {
  type: 'authors',
  resourcePath: '/api/v1/authors',
  attributes: { name: (author) => author.name },
  relationships: {},
};

const ERASED_AUTHOR: ErasedSerializer = {
  type: AUTHOR_SERIALIZER.type,
  resourcePath: AUTHOR_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown) {
    if (typeof entity !== 'object' || entity === null || !('name' in entity)) {
      throw new TypeError('author가 아니다');
    }
    const name = entity.name;
    const id = 'id' in entity ? entity.id : undefined;
    if (typeof name !== 'string' || typeof id !== 'string') {
      throw new TypeError('author가 아니다');
    }
    return serializeResource(AUTHOR_SERIALIZER, { id, name });
  },
};

const POST_SERIALIZER: ResourceSerializer<Post> = {
  type: 'posts',
  resourcePath: '/api/v1/posts',
  attributes: {
    title: (post) => post.title,
    createdAt: (post) => post.createdAt.toISOString(),
  },
  relationships: {
    author: {
      cardinality: 'one',
      eagerLoad: 'author',
      read: (post) => post.author,
      target: () => ERASED_AUTHOR,
    },
    reviewers: {
      cardinality: 'many',
      eagerLoad: 'reviewers',
      read: (post) => post.reviewers,
      target: () => ERASED_AUTHOR,
    },
  },
};

const CREATED_AT = new Date('2026-08-30T00:00:00.000Z');

function post(overrides: Partial<Post> = {}): Post {
  return { id: 'p1', title: '제목', createdAt: CREATED_AT, ...overrides };
}

describe('serializeResource', () => {
  it('type과 id를 담는다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    expect(object.type).toBe('posts');
    expect(object.id).toBe('p1');
  });

  it('선언한 attribute만 담는다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    expect(Object.keys(object.attributes).sort()).toEqual(['createdAt', 'title']);
  });

  it('attribute 값은 선언한 함수가 만든다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    expect(object.attributes.title).toBe('제목');
    expect(object.attributes.createdAt).toBe('2026-08-30T00:00:00.000Z');
  });

  it('self 링크는 resourcePath와 id로 만든다', () => {
    expect(serializeResource(POST_SERIALIZER, post()).links?.self).toBe('/api/v1/posts/p1');
  });

  it('관계마다 self와 related 링크를 낸다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    const author = object.relationships.author;
    if (author === undefined) {
      throw new Error('author 관계가 없다');
    }
    expect(author.links).toEqual({
      self: '/api/v1/posts/p1/relationships/author',
      related: '/api/v1/posts/p1/author',
    });
  });

  it('resourcePath가 없으면 링크를 내지 않는다', () => {
    // 스펙 16장의 공개 API 표면에 라우트가 없는 자원(예: include로만 노출되는
    // Category)은 self 링크를 가질 수 없다. 그런 자원에 링크를 지어내면 클라이언트가
    // 404를 따라가게 된다.
    const pathless: ResourceSerializer<Author> = {
      type: 'authors',
      attributes: { name: (author) => author.name },
      relationships: {},
    };
    const object = serializeResource(pathless, { id: 'a1', name: '글쓴이' });
    expect(object.links).toBeUndefined();
    expect(object.id).toBe('a1');
    expect(object.attributes.name).toBe('글쓴이');
  });

  it('로드되지 않은 관계는 data를 생략한다', () => {
    // 로드하지 않은 것과 "없음"은 다르다. undefined는 모른다는 뜻이므로 linkage를
    // 지어내지 않는다 — 지어내면 클라이언트가 관계가 비었다고 오해한다.
    const object = serializeResource(POST_SERIALIZER, post());
    const author = object.relationships.author;
    if (author === undefined) {
      throw new Error('author 관계가 없다');
    }
    expect('data' in author).toBe(false);
  });

  it('to-one 관계가 null이면 data도 null이다', () => {
    const object = serializeResource(POST_SERIALIZER, post({ author: null }));
    expect(object.relationships.author?.data).toBeNull();
  });

  it('to-one 관계의 linkage를 담는다', () => {
    const object = serializeResource(POST_SERIALIZER, post({ author: { id: 'a1', name: '글쓴이' } }));
    expect(object.relationships.author?.data).toEqual({ type: 'authors', id: 'a1' });
  });

  it('to-many 관계의 linkage를 배열로 담는다', () => {
    const object = serializeResource(
      POST_SERIALIZER,
      post({ reviewers: [{ id: 'a1', name: 'ㄱ' }, { id: 'a2', name: 'ㄴ' }] }),
    );
    expect(object.relationships.reviewers?.data).toEqual([
      { type: 'authors', id: 'a1' },
      { type: 'authors', id: 'a2' },
    ]);
  });

  it('빈 to-many 관계는 빈 배열이다', () => {
    const object = serializeResource(POST_SERIALIZER, post({ reviewers: [] }));
    expect(object.relationships.reviewers?.data).toEqual([]);
  });
});

describe('collectIncluded', () => {
  it('to-one 관계 대상을 대상 시리얼라이저로 직렬화한다', () => {
    const included = collectIncluded(
      POST_SERIALIZER,
      [post({ author: { id: 'a1', name: '글쓴이' } })],
      ['author'],
    );
    expect(included).toHaveLength(1);
    expect(included[0]?.type).toBe('authors');
    expect(included[0]?.attributes.name).toBe('글쓴이');
  });

  it('같은 자원을 두 번 담지 않는다', () => {
    // 여러 Post가 같은 저자를 가리키면 included에 한 번만 나와야 한다.
    const shared = { id: 'a1', name: '글쓴이' };
    const included = collectIncluded(
      POST_SERIALIZER,
      [post({ id: 'p1', author: shared }), post({ id: 'p2', author: shared })],
      ['author'],
    );
    expect(included).toHaveLength(1);
  });

  it('로드되지 않았거나 비어 있는 관계는 건너뛴다', () => {
    expect(collectIncluded(POST_SERIALIZER, [post(), post({ author: null })], ['author'])).toEqual(
      [],
    );
  });

  it('to-many 관계의 모든 대상을 담는다', () => {
    const included = collectIncluded(
      POST_SERIALIZER,
      [post({ reviewers: [{ id: 'a1', name: 'ㄱ' }, { id: 'a2', name: 'ㄴ' }] })],
      ['reviewers'],
    );
    expect(included.map((object) => object.id).sort()).toEqual(['a1', 'a2']);
  });

  it('여러 include 경로를 함께 처리한다', () => {
    const included = collectIncluded(
      POST_SERIALIZER,
      [post({ author: { id: 'a1', name: 'ㄱ' }, reviewers: [{ id: 'a2', name: 'ㄴ' }] })],
      ['author', 'reviewers'],
    );
    expect(included.map((object) => object.id).sort()).toEqual(['a1', 'a2']);
  });

  it('선언되지 않은 관계 경로는 프로그래밍 오류다', () => {
    // 사용자 입력 검증은 include.ts가 이미 끝낸 뒤에 이 함수가 불린다. 여기까지
    // 온 미선언 경로는 호출 측 버그이므로 JsonApiError가 아니라 TypeError를 던진다.
    expect(() => collectIncluded(POST_SERIALIZER, [post()], ['unknown'])).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm exec jest test/serializers/serializer.spec.ts` (실제로는 `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/serializers`)
Expected: FAIL — `Cannot find module '../../src/app/serializers/serializer.js'`

- [ ] **Step 3: 구현한다**

`src/app/serializers/serializer.ts`를 만든다.

```ts
import type { ResourceIdentifier } from '../jsonapi/document.js';

/**
 * 자원의 공개 표현 선언.
 *
 * 이 계층은 "무엇을 밖으로 보이는가"만 소유한다. 요청 값 검증(schemas/)이나 SQL filter
 * 해석(jsonapi/)은 하지 않는다. 엔티티에 컬럼을 추가해도 여기에 적지 않으면 응답에
 * 나가지 않는다 — 공개 표면이 저장 구조를 따라 조용히 넓어지는 것을 막는 장치다.
 */

/** 관계의 cardinality. */
export type RelationshipCardinality = 'one' | 'many';

/** JSON:API 관계 객체. */
export interface RelationshipObject {
  /** 부모 자원에 `resourcePath`가 없으면 만들 수 없으므로 선택이다. */
  readonly links?: { readonly self: string; readonly related: string };
  readonly data?: ResourceIdentifier | readonly ResourceIdentifier[] | null;
}

/** JSON:API 자원 객체. */
export interface ResourceObject {
  readonly type: string;
  readonly id: string;
  readonly attributes: Record<string, unknown>;
  readonly relationships: Record<string, RelationshipObject>;
  readonly links?: { readonly self: string };
}

/**
 * 타입을 지운 시리얼라이저.
 *
 * 관계 대상과 `included` 조립에 쓴다. `ResourceSerializer<T>`를 그대로 담으면 attribute
 * 읽기 함수가 파라미터 반공변 위치라 `ResourceSerializer<Category>`를
 * `ResourceSerializer<{ id: string }>`으로 넓힐 수 없다. 그래서 선언하는 쪽이
 * `serializeUnknown`에서 자기 엔티티인지 직접 좁혀 주고, 그 대가로 이 저장소에서
 * 캐스트를 하나도 쓰지 않는다.
 */
export interface ErasedSerializer {
  readonly type: string;
  readonly resourcePath?: string;
  serializeUnknown(entity: unknown): ResourceObject;
}

/** 시리얼라이저가 선언하는 관계 하나. */
export interface RelationshipDefinition<T> {
  readonly cardinality: RelationshipCardinality;
  /** `include`가 지정됐을 때 eager-load할 TypeORM 관계 경로. */
  readonly eagerLoad: string;
  /**
   * 엔티티에서 관계 값을 읽는다.
   *
   * `undefined`는 "로드하지 않았다", `null`은 "없다"로 갈라진다. 리플렉션으로
   * 프로퍼티를 문자열로 집지 않는 이유는 그 경로가 `any`를 흘려 `strictTypeChecked`를
   * 통과하지 못하기 때문이기도 하고, 선언이 곧 계약이어야 하기 때문이기도 하다.
   */
  readonly read: (entity: T) => unknown;
  /** 대상 시리얼라이저. 순환 import를 피하려 지연 참조로 받는다. */
  readonly target: () => ErasedSerializer;
}

/** 자원 하나의 공개 표현 선언. */
export interface ResourceSerializer<T extends { id: string }> {
  readonly type: string;
  /**
   * `self` 링크와 `Location` 헤더의 기준 경로. 앞에 슬래시가 있고 끝에는 없다.
   *
   * Phase 4의 `CrudActions`가 `@Controller` 경로와 이 값을 비교해 어긋나면 조립 시점에
   * 던진다. 두 값이 갈라지면 잘못된 링크가 조용히 나간다.
   *
   * **선택인 이유**: 스펙 16장의 공개 API 표면에 라우트가 없는 자원(Category·Tag는
   * `include`로만 노출된다)은 가리킬 URL 자체가 없다. 링크를 지어내면 클라이언트가
   * 404를 따라가므로, 그런 자원은 `links`를 아예 내지 않는다.
   */
  readonly resourcePath?: string;
  readonly attributes: Readonly<Record<string, (entity: T) => unknown>>;
  readonly relationships: Readonly<Record<string, RelationshipDefinition<T>>>;
}

function identifierOf(type: string, value: unknown): ResourceIdentifier {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    throw new TypeError('관계 값이 엔티티가 아니다');
  }
  const id = value.id;
  if (typeof id !== 'string') {
    throw new TypeError('관계 값의 id가 문자열이 아니다');
  }
  return { type, id };
}

function linkage(
  cardinality: RelationshipCardinality,
  type: string,
  value: unknown,
): ResourceIdentifier | ResourceIdentifier[] | null {
  if (cardinality === 'one') {
    return value === null ? null : identifierOf(type, value);
  }
  if (!Array.isArray(value)) {
    throw new TypeError('to-many 관계 값이 배열이 아니다');
  }
  // `Array.isArray`가 좁혀 주는 타입은 `any[]`다. `unknown[]`으로 받아 `any`가
  // 더 번지지 않게 막는다.
  const entries: unknown[] = value;
  return entries.map((entry) => identifierOf(type, entry));
}

/** 엔티티 하나를 JSON:API 자원 객체로 만든다. */
export function serializeResource<T extends { id: string }>(
  serializer: ResourceSerializer<T>,
  entity: T,
): ResourceObject {
  const attributes: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(serializer.attributes)) {
    attributes[name] = read(entity);
  }

  const path = serializer.resourcePath;
  const self = path === undefined ? undefined : `${path}/${entity.id}`;

  const relationships: Record<string, RelationshipObject> = {};
  for (const [name, definition] of Object.entries(serializer.relationships)) {
    const links =
      self === undefined
        ? undefined
        : { self: `${self}/relationships/${name}`, related: `${self}/${name}` };
    const value = definition.read(entity);
    const object: RelationshipObject =
      value === undefined
        ? { ...(links === undefined ? {} : { links }) }
        : {
            ...(links === undefined ? {} : { links }),
            data: linkage(definition.cardinality, definition.target().type, value),
          };
    relationships[name] = object;
  }

  return {
    type: serializer.type,
    id: entity.id,
    attributes,
    relationships,
    ...(self === undefined ? {} : { links: { self } }),
  };
}

/**
 * `include`가 지정한 관계 대상을 모아 `included` 배열을 만든다.
 *
 * 같은 자원은 한 번만 담는다 — JSON:API는 `included`에 같은 (type, id)가 두 번
 * 나오는 것을 금지한다. 경로는 이미 `include.ts`가 시리얼라이저와 정책 양쪽에
 * 대조해 통과시킨 것들이다.
 */
export function collectIncluded<T extends { id: string }>(
  serializer: ResourceSerializer<T>,
  entities: readonly T[],
  includePaths: readonly string[],
): ResourceObject[] {
  const seen = new Set<string>();
  const included: ResourceObject[] = [];

  for (const path of includePaths) {
    const definition = serializer.relationships[path];
    if (definition === undefined) {
      throw new TypeError(`선언되지 않은 관계 경로다: ${path}`);
    }
    const target = definition.target();

    for (const entity of entities) {
      const value = definition.read(entity);
      if (value === undefined || value === null) {
        continue;
      }
      const related: unknown[] = Array.isArray(value) ? value : [value];
      for (const item of related) {
        const object = target.serializeUnknown(item);
        const key = `${object.type}:${object.id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        included.push(object);
      }
    }
  }

  return included;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/serializers`
Expected: PASS (17 tests)

- [ ] **Step 5: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 모두 통과. 실패하면 `prettier --write`로 형식을 맞추고 나머지는 손으로 고친다.

- [ ] **Step 6: 커밋한다**

```bash
git add src/app/serializers/serializer.ts test/serializers/serializer.spec.ts
git commit -m "feat(serializers): 시리얼라이저 선언 타입과 자원 직렬화 추가"
```

---
### Task 2: Example·Category·Tag 시리얼라이저 선언과 명시 등록

**Files:**
- Create: `src/app/serializers/category.serializer.ts`
- Create: `src/app/serializers/tag.serializer.ts`
- Create: `src/app/serializers/example.serializer.ts`
- Create: `src/app/serializers/index.ts`
- Modify: `jest.config.js` (`src/app/serializers/index.ts`를 커버리지 대상에서 제외)
- Test: `test/serializers/example.serializer.spec.ts`

**Interfaces:**
- Consumes: `ResourceSerializer`, `ErasedSerializer`, `serializeResource` (Task 1)
- Produces:
  - `CATEGORY_SERIALIZER: ResourceSerializer<Category>` / `ERASED_CATEGORY_SERIALIZER: ErasedSerializer`
  - `TAG_SERIALIZER: ResourceSerializer<Tag>` / `ERASED_TAG_SERIALIZER: ErasedSerializer`
  - `EXAMPLE_SERIALIZER: ResourceSerializer<Example>` — `type: 'examples'`, `resourcePath: '/api/v1/examples'`, 관계 키는 `category`(one)와 `tags`(many)
  - `SERIALIZERS: readonly ErasedSerializer[]`

**공개 표면 결정 (이 태스크가 고정한다):**

| 자원 | `type` | `resourcePath` | attributes | relationships |
| --- | --- | --- | --- | --- |
| Example | `examples` | `/api/v1/examples` | `title`, `body`, `status`, `publishedAt`, `createdAt`, `updatedAt` | `category`(one), `tags`(many) |
| Category | `categories` | 없음 | `name`, `createdAt`, `updatedAt` | 없음 |
| Tag | `tags` | 없음 | `name`, `createdAt`, `updatedAt` | 없음 |

`categoryId`는 attribute로 내보내지 않는다. 내부 FK는 관계로만 노출한다 — 스펙 7.3이 linkage 입력에 대해 같은 규칙을 정하고, 출력도 같은 이유로 갈라놓는다. FK를 attribute로 열면 클라이언트가 관계 라우트 대신 그 필드를 쓰기 시작하고, 그러면 관계 계약이 두 벌이 된다.

`Date`는 ISO 8601 문자열로 내보낸다. `JSON.stringify`가 우연히 같은 결과를 내지만, 표현 형식은 시리얼라이저가 명시적으로 소유해야 나중에 저장 타입이 바뀌어도 응답이 흔들리지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/serializers/example.serializer.spec.ts`를 만든다.

```ts
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { CATEGORY_SERIALIZER } from '../../src/app/serializers/category.serializer.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
import { SERIALIZERS } from '../../src/app/serializers/index.js';
import { serializeResource } from '../../src/app/serializers/serializer.js';
import { TAG_SERIALIZER } from '../../src/app/serializers/tag.serializer.js';

const CREATED_AT = new Date('2026-08-30T01:02:03.000Z');
const UPDATED_AT = new Date('2026-08-30T04:05:06.000Z');
const PUBLISHED_AT = new Date('2026-08-30T07:08:09.000Z');

function example(overrides: Partial<Example> = {}): Example {
  // 엔티티 클래스를 실제로 만든다. `included` 조립이 `instanceof`로 좁히므로
  // 구조만 흉내 낸 객체로는 이 계약을 검증할 수 없다.
  //
  // `base`에 `Partial<Example>`을 명시하는 이유: 주석 없이 객체 리터럴을 쓰면
  // `status: 'published'`가 `string`으로 넓어져 `ExampleStatus`에 맞지 않는다.
  const base: Partial<Example> = {
    id: 'e1',
    title: '제목',
    body: '본문',
    status: 'published',
    publishedAt: PUBLISHED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    categoryId: null,
  };
  return Object.assign(new Example(), base, overrides);
}

function category(id: string, name: string): Category {
  return Object.assign(new Category(), {
    id,
    name,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  });
}

function tag(id: string, name: string): Tag {
  return Object.assign(new Tag(), { id, name, createdAt: CREATED_AT, updatedAt: UPDATED_AT });
}

describe('EXAMPLE_SERIALIZER', () => {
  it('JSON:API type과 resourcePath를 스펙대로 고정한다', () => {
    // resourcePath는 self 링크와 Location 헤더의 기준이고, Phase 4가 @Controller
    // 경로와 문자열까지 비교한다. 스펙 16장의 표와 어긋나면 안 된다.
    expect(EXAMPLE_SERIALIZER.type).toBe('examples');
    expect(EXAMPLE_SERIALIZER.resourcePath).toBe('/api/v1/examples');
  });

  it('공개 attribute 목록을 고정한다', () => {
    expect(Object.keys(EXAMPLE_SERIALIZER.attributes).sort()).toEqual([
      'body',
      'createdAt',
      'publishedAt',
      'status',
      'title',
      'updatedAt',
    ]);
  });

  it('내부 FK를 attribute로 내보내지 않는다', () => {
    // categoryId가 새면 클라이언트가 관계 라우트 대신 그 필드를 쓰게 되고
    // 관계 계약이 두 벌이 된다.
    expect(Object.keys(EXAMPLE_SERIALIZER.attributes)).not.toContain('categoryId');
  });

  it('category와 tags 관계를 cardinality와 함께 선언한다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.category?.cardinality).toBe('one');
    expect(EXAMPLE_SERIALIZER.relationships.tags?.cardinality).toBe('many');
  });

  it('관계마다 eager-load 경로를 선언한다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.category?.eagerLoad).toBe('category');
    expect(EXAMPLE_SERIALIZER.relationships.tags?.eagerLoad).toBe('tags');
  });

  it('날짜를 ISO 8601 문자열로 내보낸다', () => {
    const object = serializeResource(EXAMPLE_SERIALIZER, example());
    expect(object.attributes.createdAt).toBe('2026-08-30T01:02:03.000Z');
    expect(object.attributes.updatedAt).toBe('2026-08-30T04:05:06.000Z');
    expect(object.attributes.publishedAt).toBe('2026-08-30T07:08:09.000Z');
  });

  it('publishedAt이 null이면 null을 내보낸다', () => {
    const object = serializeResource(EXAMPLE_SERIALIZER, example({ publishedAt: null }));
    expect(object.attributes.publishedAt).toBeNull();
  });

  it('body가 null이면 null을 내보낸다', () => {
    expect(serializeResource(EXAMPLE_SERIALIZER, example({ body: null })).attributes.body).toBeNull();
  });

  it('status를 그대로 내보낸다', () => {
    expect(serializeResource(EXAMPLE_SERIALIZER, example()).attributes.status).toBe('published');
  });

  it('self 링크가 스펙 16장의 경로와 맞는다', () => {
    expect(serializeResource(EXAMPLE_SERIALIZER, example()).links?.self).toBe('/api/v1/examples/e1');
  });

  it('관계 링크가 스펙 16장의 경로와 맞는다', () => {
    const object = serializeResource(EXAMPLE_SERIALIZER, example());
    expect(object.relationships.category?.links).toEqual({
      self: '/api/v1/examples/e1/relationships/category',
      related: '/api/v1/examples/e1/category',
    });
    expect(object.relationships.tags?.links).toEqual({
      self: '/api/v1/examples/e1/relationships/tags',
      related: '/api/v1/examples/e1/tags',
    });
  });

  it('로드된 category의 linkage를 낸다', () => {
    const object = serializeResource(
      EXAMPLE_SERIALIZER,
      example({ category: category('c1', '안내서') }),
    );
    expect(object.relationships.category?.data).toEqual({ type: 'categories', id: 'c1' });
  });

  it('로드된 tags의 linkage를 낸다', () => {
    const object = serializeResource(
      EXAMPLE_SERIALIZER,
      example({ tags: [tag('t1', 'a'), tag('t2', 'b')] }),
    );
    expect(object.relationships.tags?.data).toEqual([
      { type: 'tags', id: 't1' },
      { type: 'tags', id: 't2' },
    ]);
  });
});

describe('CATEGORY_SERIALIZER / TAG_SERIALIZER', () => {
  it('include 전용이므로 resourcePath가 없다', () => {
    // 스펙 16장에 categories·tags 단건 라우트가 없다. self 링크를 지어내면
    // 클라이언트가 404를 따라간다.
    expect(CATEGORY_SERIALIZER.resourcePath).toBeUndefined();
    expect(TAG_SERIALIZER.resourcePath).toBeUndefined();
  });

  it('JSON:API type을 고정한다', () => {
    expect(CATEGORY_SERIALIZER.type).toBe('categories');
    expect(TAG_SERIALIZER.type).toBe('tags');
  });

  it('공개 attribute 목록을 고정한다', () => {
    expect(Object.keys(CATEGORY_SERIALIZER.attributes).sort()).toEqual([
      'createdAt',
      'name',
      'updatedAt',
    ]);
    expect(Object.keys(TAG_SERIALIZER.attributes).sort()).toEqual([
      'createdAt',
      'name',
      'updatedAt',
    ]);
  });

  it('링크 없이 직렬화된다', () => {
    const object = serializeResource(CATEGORY_SERIALIZER, category('c1', '안내서'));
    expect(object.links).toBeUndefined();
    expect(object.attributes.name).toBe('안내서');
  });
});

describe('관계 대상 시리얼라이저', () => {
  it('category 관계 대상이 categories 시리얼라이저다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.category?.target().type).toBe('categories');
  });

  it('tags 관계 대상이 tags 시리얼라이저다', () => {
    expect(EXAMPLE_SERIALIZER.relationships.tags?.target().type).toBe('tags');
  });

  it('엔티티가 아닌 값을 받으면 던진다', () => {
    // `serializeUnknown`은 타입을 지운 진입점이다. 좁히기를 빠뜨리면 엉뚱한 객체가
    // 조용히 직렬화되므로, 좁히기가 실제로 걸리는지 확인한다.
    const target = EXAMPLE_SERIALIZER.relationships.category?.target();
    if (target === undefined) {
      throw new Error('category 관계가 없다');
    }
    expect(() => target.serializeUnknown({ id: 'c1', name: '흉내' })).toThrow(TypeError);
  });
});

describe('SERIALIZERS 등록', () => {
  it('세 시리얼라이저를 명시적으로 담는다', () => {
    expect(SERIALIZERS.map((serializer) => serializer.type).sort()).toEqual([
      'categories',
      'examples',
      'tags',
    ]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/serializers`
Expected: FAIL — `Cannot find module '../../src/app/serializers/category.serializer.js'`

- [ ] **Step 3: Category와 Tag 시리얼라이저를 만든다**

`src/app/serializers/category.serializer.ts`:

```ts
import { Category } from '../models/category.entity.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';

/**
 * Category의 공개 표현.
 *
 * `resourcePath`가 없다. 스펙 16장의 공개 API 표면에 `/api/v1/categories` 라우트가
 * 없기 때문이다 — 이 자원은 Example의 `include`로만 밖에 나간다. 없는 URL을 가리키는
 * `self` 링크를 지어내지 않는다.
 *
 * 반대편 관계(`examples`)는 선언하지 않는다. 선언하면 include 대상이 되고, 그러면
 * Category 하나가 Example 전체를 끌고 나올 수 있다.
 */
export const CATEGORY_SERIALIZER: ResourceSerializer<Category> = {
  type: 'categories',
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
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Category)) {
      throw new TypeError('Category 엔티티가 아니다');
    }
    return serializeResource(CATEGORY_SERIALIZER, entity);
  },
};
```

`src/app/serializers/tag.serializer.ts`:

```ts
import { Tag } from '../models/tag.entity.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';

/**
 * Tag의 공개 표현.
 *
 * `CATEGORY_SERIALIZER`와 같은 이유로 `resourcePath`가 없고 반대편 관계도 선언하지
 * 않는다(`category.serializer.ts` 주석 참고).
 */
export const TAG_SERIALIZER: ResourceSerializer<Tag> = {
  type: 'tags',
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
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Tag)) {
      throw new TypeError('Tag 엔티티가 아니다');
    }
    return serializeResource(TAG_SERIALIZER, entity);
  },
};
```

- [ ] **Step 4: Example 시리얼라이저를 만든다**

`src/app/serializers/example.serializer.ts`:

```ts
import { Example } from '../models/example.entity.js';
import { ERASED_CATEGORY_SERIALIZER } from './category.serializer.js';
import { serializeResource } from './serializer.js';
import type { ErasedSerializer, ResourceObject, ResourceSerializer } from './serializer.js';
import { ERASED_TAG_SERIALIZER } from './tag.serializer.js';

/**
 * Example의 공개 표현.
 *
 * `categoryId`는 attribute가 아니다. 내부 FK는 `category` 관계로만 노출한다 —
 * 스펙 7.3이 입력에 대해 같은 규칙을 정하고, 출력도 같은 이유로 갈라놓는다. FK를
 * attribute로 열면 클라이언트가 관계 라우트 대신 그 필드를 쓰기 시작하고, 그때부터
 * 관계 계약이 두 벌이 된다.
 *
 * 날짜는 여기서 ISO 8601 문자열로 바꾼다. `JSON.stringify`가 우연히 같은 결과를
 * 내지만, 표현 형식의 소유자는 시리얼라이저여야 저장 타입이 바뀌어도 응답이 흔들리지
 * 않는다.
 */
export const EXAMPLE_SERIALIZER: ResourceSerializer<Example> = {
  type: 'examples',
  resourcePath: '/api/v1/examples',
  attributes: {
    title: (example) => example.title,
    body: (example) => example.body,
    status: (example) => example.status,
    publishedAt: (example) => example.publishedAt?.toISOString() ?? null,
    createdAt: (example) => example.createdAt.toISOString(),
    updatedAt: (example) => example.updatedAt.toISOString(),
  },
  relationships: {
    category: {
      cardinality: 'one',
      eagerLoad: 'category',
      read: (example) => example.category,
      target: () => ERASED_CATEGORY_SERIALIZER,
    },
    tags: {
      cardinality: 'many',
      eagerLoad: 'tags',
      read: (example) => example.tags,
      target: () => ERASED_TAG_SERIALIZER,
    },
  },
};

/** 관계 대상과 `included` 조립용. 자기 엔티티인지 직접 좁힌다. */
export const ERASED_EXAMPLE_SERIALIZER: ErasedSerializer = {
  type: EXAMPLE_SERIALIZER.type,
  resourcePath: EXAMPLE_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown): ResourceObject {
    if (!(entity instanceof Example)) {
      throw new TypeError('Example 엔티티가 아니다');
    }
    return serializeResource(EXAMPLE_SERIALIZER, entity);
  },
};
```

- [ ] **Step 5: 명시 등록 배열을 만든다**

`src/app/serializers/index.ts`:

```ts
import { ERASED_CATEGORY_SERIALIZER } from './category.serializer.js';
import { ERASED_EXAMPLE_SERIALIZER } from './example.serializer.js';
import type { ErasedSerializer } from './serializer.js';
import { ERASED_TAG_SERIALIZER } from './tag.serializer.js';

export { CATEGORY_SERIALIZER, ERASED_CATEGORY_SERIALIZER } from './category.serializer.js';
export { EXAMPLE_SERIALIZER, ERASED_EXAMPLE_SERIALIZER } from './example.serializer.js';
export { TAG_SERIALIZER, ERASED_TAG_SERIALIZER } from './tag.serializer.js';
export { collectIncluded, serializeResource } from './serializer.js';
export type {
  ErasedSerializer,
  RelationshipCardinality,
  RelationshipDefinition,
  RelationshipObject,
  ResourceObject,
  ResourceSerializer,
} from './serializer.js';

/**
 * 이 저장소가 아는 시리얼라이저의 유일한 목록.
 *
 * 엔티티·마이그레이션 목록과 같은 계약이다 — glob으로 탐색하지 않고, 이 배열에 없는
 * 시리얼라이저는 존재하지 않는 것과 같다.
 */
export const SERIALIZERS: readonly ErasedSerializer[] = [
  ERASED_EXAMPLE_SERIALIZER,
  ERASED_CATEGORY_SERIALIZER,
  ERASED_TAG_SERIALIZER,
];
```

- [ ] **Step 6: 커버리지 대상에서 등록 파일을 제외한다**

`jest.config.js`의 `collectCoverageFrom` 배열에 아래 줄을 `'!src/db/migrations/index.ts',` 다음에 넣는다.

```js
    '!src/app/serializers/index.ts',
```

(`src/app/models/index.ts`·`src/db/migrations/index.ts`와 같은 이유다 — 등록 배열만 담은 파일이고, 내용은 위 테스트가 고정한다.)

- [ ] **Step 7: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/serializers`
Expected: PASS (Task 1의 17개 + 이 태스크의 20개)

- [ ] **Step 8: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 모두 통과

- [ ] **Step 9: 커밋한다**

```bash
git add src/app/serializers test/serializers/example.serializer.spec.ts jest.config.js
git commit -m "feat(serializers): Example·Category·Tag 공개 표현과 명시 등록 추가"
```

---

### Task 3: QueryPolicy 선언 타입

**Files:**
- Create: `src/app/schemas/query-policy.ts`
- Test: `test/schemas/query-policy.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type FilterOperator = 'exact' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'isNull'`
  - `const FILTER_OPERATORS: readonly FilterOperator[]`
  - `type FilterValueType = 'string' | 'number' | 'boolean' | 'uuid' | 'timestamp' | 'enum'`
  - `interface FilterFieldPolicy { property: string; type: FilterValueType; operators: readonly FilterOperator[]; values?: readonly string[] }`
  - `interface SortFieldPolicy { property: string; nullable: boolean }`
  - `type SortDirection = 'ASC' | 'DESC'`
  - `interface SortTerm { field: string; direction: SortDirection }`
  - `interface QueryPolicy { filters: Readonly<Record<string, FilterFieldPolicy>>; sorts: Readonly<Record<string, SortFieldPolicy>>; includes: readonly string[]; defaultSort: readonly SortTerm[]; tieBreaker: SortTerm; defaultPageSize: number }`
  - `const MAX_PAGE_SIZE = 100`
  - `function isFilterOperator(value: string): value is FilterOperator`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/schemas/query-policy.spec.ts`를 만든다.

```ts
import {
  FILTER_OPERATORS,
  MAX_PAGE_SIZE,
  isFilterOperator,
} from '../../src/app/schemas/query-policy.js';

describe('FILTER_OPERATORS', () => {
  it('스펙 8.1이 정한 여덟 연산자를 담는다', () => {
    expect([...FILTER_OPERATORS].sort()).toEqual([
      'contains',
      'exact',
      'gt',
      'gte',
      'in',
      'isNull',
      'lt',
      'lte',
    ]);
  });
});

describe('isFilterOperator', () => {
  it('카탈로그에 있는 이름을 받는다', () => {
    expect(isFilterOperator('exact')).toBe(true);
    expect(isFilterOperator('isNull')).toBe(true);
  });

  it('없는 이름을 거부한다', () => {
    expect(isFilterOperator('like')).toBe(false);
    expect(isFilterOperator('')).toBe(false);
    expect(isFilterOperator('EXACT')).toBe(false);
  });
});

describe('MAX_PAGE_SIZE', () => {
  it('스펙 8.2가 정한 100이다', () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/schemas`
Expected: FAIL — `Cannot find module '../../src/app/schemas/query-policy.js'`

- [ ] **Step 3: 구현한다**

`src/app/schemas/query-policy.ts`:

```ts
/**
 * 자원별 조회 허용 목록.
 *
 * 이 계층은 "무엇을 질의할 수 있는가"만 소유한다. 실제 SQL 조립은
 * `jsonapi/query-compiler.ts`가 하고, 요청 문자열 해석은 `jsonapi/`의 파서들이 한다.
 *
 * **열 이름은 언제나 이 선언에서만 나온다.** 사용자가 보낸 문자열은 이 표의 키를 찾는
 * 데만 쓰이고, SQL에 들어가는 것은 표가 들고 있는 `property`다. 이 규칙이 깨지면
 * 조회 파라미터가 곧바로 SQL 주입 경로가 된다.
 */

/** 스펙 8.1이 정한 연산자. 임의로 늘리지 않는다. */
export type FilterOperator = 'exact' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'isNull';

/** 연산자 목록. 순서는 선언 순서를 따른다. */
export const FILTER_OPERATORS: readonly FilterOperator[] = [
  'exact',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'isNull',
];

/** 문자열이 알려진 연산자인지 판정한다. */
export function isFilterOperator(value: string): value is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(value);
}

/**
 * 필터 값의 저장 형식.
 *
 * 파서가 이 값을 보고 문자열을 엄격하게 변환한다. `'2026-13-40'`이나 `'참'` 같은 값은
 * 여기서 걸러지고 SQL까지 가지 않는다.
 */
export type FilterValueType = 'string' | 'number' | 'boolean' | 'uuid' | 'timestamp' | 'enum';

/** 필터 가능한 필드 하나의 정책. */
export interface FilterFieldPolicy {
  /** 엔티티 프로퍼티 이름. SQL에 들어가는 것은 언제나 이 값이다. */
  readonly property: string;
  readonly type: FilterValueType;
  readonly operators: readonly FilterOperator[];
  /** `type`이 `'enum'`일 때 허용 값. 다른 타입에서는 쓰지 않는다. */
  readonly values?: readonly string[];
}

/** 정렬 가능한 필드 하나의 정책. */
export interface SortFieldPolicy {
  /** 엔티티 프로퍼티 이름. */
  readonly property: string;
  /**
   * 이 컬럼이 NULL을 허용하는가.
   *
   * keyset 커서는 `(컬럼, id) > (값, 값)` 비교로 자르는데, NULL이 섞이면 비교가
   * unknown이 되어 행을 조용히 건너뛴다. 그래서 커서 모드는 nullable 정렬을
   * `INVALID_PAGE`로 거부한다(스펙 8.2).
   */
  readonly nullable: boolean;
}

/** 정렬 방향. */
export type SortDirection = 'ASC' | 'DESC';

/** 정렬 항목 하나. `field`는 공개 이름이고 정책이 프로퍼티로 옮긴다. */
export interface SortTerm {
  readonly field: string;
  readonly direction: SortDirection;
}

/** 한 페이지에 담을 수 있는 최대 개수(스펙 8.2). */
export const MAX_PAGE_SIZE = 100;

/**
 * 한 자원의 조회 정책.
 *
 * **인덱스 동기화 규칙(스펙 8.3)**: `filters`·`sorts`를 늘리거나 `defaultSort`·
 * `tieBreaker`를 바꿀 때는 해당 컬럼 조합의 인덱스 필요 여부를 같은 변경에서 판단하고,
 * 필요하면 엔티티 인덱스 선언과 마이그레이션에 함께 반영한다. 만들지 않기로 했으면
 * 근거를 정책 선언부 주석에 남긴다. 모든 정렬 뒤에 `tieBreaker`가 덧붙으므로 유용한
 * 인덱스는 `(<컬럼>, id)`다.
 */
export interface QueryPolicy {
  readonly filters: Readonly<Record<string, FilterFieldPolicy>>;
  readonly sorts: Readonly<Record<string, SortFieldPolicy>>;
  /** 허용하는 `include` 경로. 시리얼라이저의 관계 선언과 교집합을 이룬다. */
  readonly includes: readonly string[];
  /** `sort`가 없을 때 쓰는 정렬. */
  readonly defaultSort: readonly SortTerm[];
  /** 모든 정렬 뒤에 붙는 마지막 기준. 결과 순서를 전순서로 만든다. */
  readonly tieBreaker: SortTerm;
  /** `page[size]`가 없을 때 쓰는 크기. */
  readonly defaultPageSize: number;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/schemas`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/schemas/query-policy.ts test/schemas/query-policy.spec.ts
git commit -m "feat(schemas): QueryPolicy 선언 타입과 연산자 목록 추가"
```

---
### Task 4: Example 조회 정책과 그 정렬을 뒷받침하는 인덱스

스펙 8.3은 정렬을 여는 것과 인덱스를 만드는 것을 **같은 변경**에 두라고 정한다. 그래서 이 태스크는 정책 선언·엔티티 인덱스·마이그레이션을 한 커밋에 담는다.

**Files:**
- Create: `src/app/schemas/example.query-policy.ts`
- Create: `src/app/schemas/index.ts`
- Create: `src/db/migrations/20260830000000-add-example-sort-indexes.ts`
- Modify: `src/app/models/example.entity.ts` (인덱스 선언 2개 추가)
- Modify: `src/db/migrations/index.ts` (`MIGRATIONS` 배열에 추가)
- Modify: `jest.config.js` (`src/app/schemas/index.ts` 제외)
- Test: `test/schemas/example.query-policy.spec.ts`

**Interfaces:**
- Consumes: `QueryPolicy`, `SortTerm`, `MAX_PAGE_SIZE` (Task 3); `EXAMPLE_STATUSES` (`src/app/models/example.entity.ts`); `EXAMPLE_SERIALIZER` (Task 2)
- Produces: `EXAMPLE_QUERY_POLICY: QueryPolicy`

**정책 표 (이 태스크가 고정한다):**

| 공개 filter 이름 | property | 타입 | 연산자 |
| --- | --- | --- | --- |
| `title` | `title` | string | `exact`, `contains` |
| `status` | `status` | enum(`EXAMPLE_STATUSES`) | `exact`, `in` |
| `category` | `categoryId` | uuid | `exact`, `in`, `isNull` |
| `createdAt` | `createdAt` | timestamp | `gt`, `gte`, `lt`, `lte` |
| `publishedAt` | `publishedAt` | timestamp | `gt`, `gte`, `lt`, `lte`, `isNull` |

공개 이름 `category`가 property `categoryId`로 옮겨지는 것이 이 표의 핵심이다. 밖에서는 관계 이름으로 보이고 안에서는 FK 컬럼을 쓴다 — 공개 이름과 저장 이름을 갈라 두면 컬럼을 바꿔도 API가 흔들리지 않고, 사용자 입력이 열 이름이 되는 경로도 막힌다.

| 공개 sort 이름 | property | nullable |
| --- | --- | --- |
| `createdAt` | `createdAt` | 아니오 |
| `publishedAt` | `publishedAt` | **예** |
| `title` | `title` | 아니오 |
| `id` | `id` | 아니오 |

`includes`: `category`, `tags`. `defaultSort`: `createdAt DESC`. `tieBreaker`: `id ASC`. `defaultPageSize`: `25`.

**인덱스 판단 (스펙 8.3):**

- `createdAt` — `IDX_examples_created_at_id`가 이미 있다(초기 스키마). 추가 없음.
- `title` — `(title, id)` 인덱스를 이 변경에서 만든다.
- `publishedAt` — `(published_at, id)` 인덱스를 이 변경에서 만든다.
- `id` — 기본키 인덱스로 커버된다. 추가 없음.
- filter 전용 컬럼(`status`, `category_id`)에는 인덱스를 만들지 않는다. 근거는 정책 주석에 남긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/schemas/example.query-policy.spec.ts`를 만든다.

```ts
import { EXAMPLE_STATUSES } from '../../src/app/models/example.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import { isFilterOperator, MAX_PAGE_SIZE } from '../../src/app/schemas/query-policy.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';

describe('EXAMPLE_QUERY_POLICY filter', () => {
  it('허용 필드를 고정한다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.filters).sort()).toEqual([
      'category',
      'createdAt',
      'publishedAt',
      'status',
      'title',
    ]);
  });

  it('공개 이름 category를 FK 컬럼 property로 옮긴다', () => {
    // 밖에서는 관계 이름, 안에서는 FK. 두 이름을 갈라 두면 컬럼이 바뀌어도 API가
    // 흔들리지 않는다.
    expect(EXAMPLE_QUERY_POLICY.filters.category?.property).toBe('categoryId');
  });

  it('모든 필드가 알려진 연산자만 선언한다', () => {
    for (const field of Object.values(EXAMPLE_QUERY_POLICY.filters)) {
      expect(field.operators.length).toBeGreaterThan(0);
      for (const operator of field.operators) {
        expect(isFilterOperator(operator)).toBe(true);
      }
    }
  });

  it('status는 엔티티의 enum 값만 받는다', () => {
    // 정책의 허용 값과 저장 enum이 갈라지면 통과한 필터가 SQL에서 터진다.
    expect(EXAMPLE_QUERY_POLICY.filters.status?.type).toBe('enum');
    expect([...(EXAMPLE_QUERY_POLICY.filters.status?.values ?? [])].sort()).toEqual(
      [...EXAMPLE_STATUSES].sort(),
    );
  });

  it('enum이 아닌 필드는 values를 선언하지 않는다', () => {
    for (const [name, field] of Object.entries(EXAMPLE_QUERY_POLICY.filters)) {
      if (field.type !== 'enum') {
        expect(`${name}:${String(field.values)}`).toBe(`${name}:undefined`);
      }
    }
  });
});

describe('EXAMPLE_QUERY_POLICY sort', () => {
  it('허용 필드를 고정한다', () => {
    expect(Object.keys(EXAMPLE_QUERY_POLICY.sorts).sort()).toEqual([
      'createdAt',
      'id',
      'publishedAt',
      'title',
    ]);
  });

  it('publishedAt만 nullable로 표시한다', () => {
    // nullable 정렬은 keyset 커서에서 거부된다(스펙 8.2). 이 표시가 틀리면
    // 커서가 행을 조용히 건너뛴다.
    expect(EXAMPLE_QUERY_POLICY.sorts.publishedAt?.nullable).toBe(true);
    expect(EXAMPLE_QUERY_POLICY.sorts.createdAt?.nullable).toBe(false);
    expect(EXAMPLE_QUERY_POLICY.sorts.title?.nullable).toBe(false);
    expect(EXAMPLE_QUERY_POLICY.sorts.id?.nullable).toBe(false);
  });

  it('기본 정렬은 createdAt 내림차순이다', () => {
    expect(EXAMPLE_QUERY_POLICY.defaultSort).toEqual([{ field: 'createdAt', direction: 'DESC' }]);
  });

  it('tie breaker는 id 오름차순이다', () => {
    expect(EXAMPLE_QUERY_POLICY.tieBreaker).toEqual({ field: 'id', direction: 'ASC' });
  });

  it('defaultSort와 tieBreaker가 sorts에 선언된 이름만 쓴다', () => {
    // 컴파일러는 sorts 표를 거쳐야 프로퍼티를 얻는다. 표에 없는 이름을 쓰면
    // 기본 정렬이 런타임에 터진다.
    const names = Object.keys(EXAMPLE_QUERY_POLICY.sorts);
    for (const term of EXAMPLE_QUERY_POLICY.defaultSort) {
      expect(names).toContain(term.field);
    }
    expect(names).toContain(EXAMPLE_QUERY_POLICY.tieBreaker.field);
  });
});

describe('EXAMPLE_QUERY_POLICY include', () => {
  it('시리얼라이저가 선언한 관계만 허용한다', () => {
    // 스펙 8.1: include는 시리얼라이저 선언과 정책 양쪽에서 허용되어야 한다.
    // 정책에만 있는 경로는 영원히 통과할 수 없으므로 선언 자체가 잘못이다.
    const declared = Object.keys(EXAMPLE_SERIALIZER.relationships);
    for (const path of EXAMPLE_QUERY_POLICY.includes) {
      expect(declared).toContain(path);
    }
  });

  it('category와 tags를 연다', () => {
    expect([...EXAMPLE_QUERY_POLICY.includes].sort()).toEqual(['category', 'tags']);
  });
});

describe('EXAMPLE_QUERY_POLICY 페이지', () => {
  it('기본 페이지 크기가 최대치를 넘지 않는다', () => {
    expect(EXAMPLE_QUERY_POLICY.defaultPageSize).toBeGreaterThan(0);
    expect(EXAMPLE_QUERY_POLICY.defaultPageSize).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/schemas`
Expected: FAIL — `Cannot find module '../../src/app/schemas/example.query-policy.js'`

- [ ] **Step 3: 정책을 선언한다**

`src/app/schemas/example.query-policy.ts`:

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
 * - `title` 정렬: `IDX_examples_title_id`를 이 정책과 같은 변경에서 만들었다.
 * - `publishedAt` 정렬: `IDX_examples_published_at_id`를 같은 변경에서 만들었다.
 * - `id` 정렬: 기본키 인덱스로 커버된다.
 * - `status`·`category` 필터: 인덱스를 **만들지 않는다**. 둘 다 선택도가 낮아(상태 3종,
 *   분류 소수) 인덱스가 있어도 플래너가 순차 스캔을 고르기 쉽고, 정렬을 동반한 목록
 *   조회는 위의 `(정렬 컬럼, id)` 인덱스가 이미 이끈다. 분류 수가 크게 늘거나 특정
 *   상태만 조회하는 경로가 주된 부하가 되면 그때 `(category_id, created_at, id)` 같은
 *   복합 인덱스를 같은 규칙으로 판단해 추가한다.
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
    // 공개 이름은 관계 이름, property는 FK 컬럼이다. 내부 컬럼 이름을 공개 표면에
    // 올리지 않으면서도 관계로 거를 수 있게 한다.
    category: { property: 'categoryId', type: 'uuid', operators: ['exact', 'in', 'isNull'] },
    createdAt: { property: 'createdAt', type: 'timestamp', operators: ['gt', 'gte', 'lt', 'lte'] },
    publishedAt: {
      property: 'publishedAt',
      type: 'timestamp',
      operators: ['gt', 'gte', 'lt', 'lte', 'isNull'],
    },
  },
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
    // NULL을 허용하므로 keyset 커서가 이 정렬을 거부한다(스펙 8.2).
    publishedAt: { property: 'publishedAt', nullable: true },
    title: { property: 'title', nullable: false },
    id: { property: 'id', nullable: false },
  },
  includes: ['category', 'tags'],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};
```

`src/app/schemas/index.ts`:

```ts
export { EXAMPLE_QUERY_POLICY } from './example.query-policy.js';
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
```

- [ ] **Step 4: 엔티티에 인덱스를 선언한다**

`src/app/models/example.entity.ts`의 클래스 데코레이터에 두 줄을 더한다. 기존 `@Index('IDX_examples_created_at_id', ...)` 바로 아래에 둔다.

```ts
@Index('IDX_examples_created_at_id', ['createdAt', 'id'])
@Index('IDX_examples_title_id', ['title', 'id'])
@Index('IDX_examples_published_at_id', ['publishedAt', 'id'])
@Entity({ name: 'examples' })
export class Example {
```

같은 파일의 클래스 주석에서 `title` 인덱스를 Phase 3으로 미룬다고 적은 문장을 아래로 바꾼다.

```
 * `(created_at, id)`·`(title, id)`·`(published_at, id)` 인덱스: 스펙 8.3에 따라 모든 정렬
 * 뒤에 `id ASC`가 tie breaker로 덧붙으므로, 정렬이 실제로 인덱스를 타려면 두 컬럼이 함께
 * 있어야 한다. 세 컬럼은 `EXAMPLE_QUERY_POLICY.sorts`가 여는 정렬과 1:1로 대응한다 —
 * 정렬을 늘리면 이 목록도 같은 변경에서 늘어나야 한다.
```

- [ ] **Step 5: 마이그레이션을 만든다**

`src/db/migrations/20260830000000-add-example-sort-indexes.ts`:

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `EXAMPLE_QUERY_POLICY`가 여는 정렬을 뒷받침하는 인덱스.
 *
 * 클래스명 끝의 `1788048000000`은 `2026-08-30T00:00:00Z`의 epoch millis다. 파일명의
 * `20260830000000`과 같은 시각을 가리켜야 한다.
 *
 * 스펙 8.3이 정렬을 여는 변경과 인덱스를 만드는 변경을 같은 커밋에 두라고 정한다.
 * 모든 정렬 뒤에 `id ASC`가 붙으므로 컬럼 조합은 `(<정렬 컬럼>, id)`다.
 */
export class AddExampleSortIndexes1788048000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_title_id" ON "examples" ("title", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_examples_published_at_id" ON "examples" ("published_at", "id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_examples_published_at_id"`);
    await queryRunner.query(`DROP INDEX "IDX_examples_title_id"`);
  }
}
```

`src/db/migrations/index.ts`를 고친다.

```ts
import type { MigrationInterface } from 'typeorm';
import { AddExampleSortIndexes1788048000000 } from './20260830000000-add-example-sort-indexes.js';
import { CreateExampleSchema1787961600000 } from './20260829000000-create-example-schema.js';
```

그리고 배열을 바꾼다.

```ts
export const MIGRATIONS: readonly MigrationClass[] = [
  CreateExampleSchema1787961600000,
  AddExampleSortIndexes1788048000000,
];
```

- [ ] **Step 6: 커버리지 대상에서 등록 파일을 제외한다**

`jest.config.js`의 `collectCoverageFrom`에 넣는다.

```js
    '!src/app/schemas/index.ts',
```

- [ ] **Step 7: 스키마 드리프트와 되돌리기 테스트가 새 인덱스를 인정하는지 확인한다**

`test/integration/migrations.spec.ts`의 "엔티티 메타데이터가 실제 스키마와 어긋나지 않는다"가 이 변경의 안전망이다. 엔티티 인덱스 선언과 마이그레이션 SQL이 어긋나면 `upQueries`가 비지 않는다.

`test/integration/migrations.spec.ts`의 인덱스 테스트를 세 인덱스 모두로 넓힌다.

```ts
  it('정책이 여는 정렬마다 (컬럼, id) 인덱스를 만든다', async () => {
    const rows = await dataSource.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'examples'`,
    );
    const names = rows.map((row) => row.indexname);
    expect(names).toContain('IDX_examples_created_at_id');
    expect(names).toContain('IDX_examples_title_id');
    expect(names).toContain('IDX_examples_published_at_id');
  });
```

(기존 `'(created_at, id) 인덱스를 만든다'` 테스트를 이 테스트로 대체한다.)

- [ ] **Step 8: 실제 PostgreSQL로 전부 확인한다**

Run: `./scripts/check.sh`
Expected: exit 0. 특히 아래 셋이 통과해야 한다.
- `마이그레이션 적용 > 엔티티 메타데이터가 실제 스키마와 어긋나지 않는다`
- `마이그레이션 down > down이 인덱스를 남기지 않는다`
- `마이그레이션 명명 규약 > 파일명 타임스탬프와 클래스명 타임스탬프가 같은 시각을 가리킨다`

- [ ] **Step 9: 커밋한다**

```bash
git add src/app/schemas src/app/models/example.entity.ts src/db/migrations test/schemas/example.query-policy.spec.ts test/integration/migrations.spec.ts jest.config.js
git commit -m "feat(schemas): Example 조회 정책과 정렬 인덱스를 같은 변경으로 추가"
```

---

### Task 5: filter 파싱과 저장 형식 변환

**Files:**
- Create: `src/app/jsonapi/filter.ts`
- Test: `test/jsonapi/filter.spec.ts`

**Interfaces:**
- Consumes: `QueryPolicy`, `FilterOperator`, `FilterFieldPolicy` (Task 3); `JsonApiError` (`src/app/jsonapi/errors.ts`)
- Produces:
  - `type ScalarFilterValue = string | number | boolean | Date`
  - `type FilterValue = ScalarFilterValue | readonly ScalarFilterValue[] | null`
  - `interface FilterCondition { parameter: string; property: string; operator: FilterOperator; value: FilterValue }`
  - `const FILTER_KEY_PATTERN: RegExp`
  - `function isFilterKey(key: string): boolean`
  - `function parseFilters(query: Readonly<Record<string, string | readonly string[] | undefined>>, policy: QueryPolicy): FilterCondition[]`

**입력 형태:** Express 5의 기본 query parser는 `'simple'`이라 `req.query`가 대괄호를 그대로 가진 평평한 객체다(실측: `?filter[status][in]=a,b` → `{ 'filter[status][in]': 'a,b' }`). 그래서 이 파서는 중첩 객체가 아니라 평평한 문자열 맵을 받는다. Phase 4가 앱 조립에서 `app.set('query parser', 'simple')`로 이 동작을 못 박는다.

**키 문법:** `filter[<field>]`(연산자 생략 시 `exact`), `filter[<field>][<operator>]`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/filter.spec.ts`를 만든다.

```ts
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { isFilterKey, parseFilters } from '../../src/app/jsonapi/filter.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {
    title: { property: 'title', type: 'string', operators: ['exact', 'contains'] },
    size: { property: 'size', type: 'number', operators: ['exact', 'gt', 'lte'] },
    active: { property: 'active', type: 'boolean', operators: ['exact'] },
    category: { property: 'categoryId', type: 'uuid', operators: ['exact', 'in', 'isNull'] },
    createdAt: { property: 'createdAt', type: 'timestamp', operators: ['gte', 'lt'] },
    status: {
      property: 'status',
      type: 'enum',
      operators: ['exact', 'in'],
      values: ['draft', 'published'],
    },
  },
  sorts: { id: { property: 'id', nullable: false } },
  includes: [],
  defaultSort: [{ field: 'id', direction: 'ASC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

const UUID = '0195c1a0-0000-7000-8000-000000000001';

/** `JsonApiError`가 아닌 오류는 그대로 다시 던져 테스트를 실패시킨다. */
function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('isFilterKey', () => {
  it('filter 키를 알아본다', () => {
    expect(isFilterKey('filter[title]')).toBe(true);
    expect(isFilterKey('filter[title][contains]')).toBe(true);
  });

  it('filter가 아닌 키를 거른다', () => {
    expect(isFilterKey('sort')).toBe(false);
    expect(isFilterKey('page[size]')).toBe(false);
    expect(isFilterKey('filter')).toBe(false);
    expect(isFilterKey('filter[]')).toBe(false);
  });
});

describe('parseFilters 기본 동작', () => {
  it('filter가 없으면 빈 배열이다', () => {
    expect(parseFilters({}, POLICY)).toEqual([]);
  });

  it('연산자를 생략하면 exact다', () => {
    expect(parseFilters({ 'filter[title]': '제목' }, POLICY)).toEqual([
      { parameter: 'filter[title]', property: 'title', operator: 'exact', value: '제목' },
    ]);
  });

  it('연산자를 명시하면 그대로 쓴다', () => {
    expect(parseFilters({ 'filter[title][contains]': '제' }, POLICY)).toEqual([
      { parameter: 'filter[title][contains]', property: 'title', operator: 'contains', value: '제' },
    ]);
  });

  it('공개 이름이 아니라 정책의 property를 쓴다', () => {
    // 사용자 입력이 열 이름이 되는 경로를 막는 계약이다.
    expect(parseFilters({ 'filter[category]': UUID }, POLICY)[0]?.property).toBe('categoryId');
  });

  it('여러 필터를 모두 담는다', () => {
    const conditions = parseFilters(
      { 'filter[title]': '제목', 'filter[size][gt]': '3' },
      POLICY,
    );
    expect(conditions).toHaveLength(2);
  });

  it('filter가 아닌 파라미터는 무시한다', () => {
    // 알 수 없는 파라미터 거부는 query.ts의 책임이다. 여기서 두 번 하지 않는다.
    expect(parseFilters({ sort: '-createdAt', 'page[size]': '10' }, POLICY)).toEqual([]);
  });
});

describe('parseFilters 값 변환', () => {
  it('number를 숫자로 바꾼다', () => {
    expect(parseFilters({ 'filter[size]': '42' }, POLICY)[0]?.value).toBe(42);
    expect(parseFilters({ 'filter[size][gt]': '-3.5' }, POLICY)[0]?.value).toBe(-3.5);
  });

  it('boolean을 참거짓으로 바꾼다', () => {
    expect(parseFilters({ 'filter[active]': 'true' }, POLICY)[0]?.value).toBe(true);
    expect(parseFilters({ 'filter[active]': 'false' }, POLICY)[0]?.value).toBe(false);
  });

  it('timestamp를 Date로 바꾼다', () => {
    const value = parseFilters({ 'filter[createdAt][gte]': '2026-08-30T00:00:00Z' }, POLICY)[0]
      ?.value;
    expect(value).toBeInstanceOf(Date);
    expect(value instanceof Date ? value.toISOString() : '').toBe('2026-08-30T00:00:00.000Z');
  });

  it('in은 쉼표로 나눠 배열로 만든다', () => {
    expect(parseFilters({ 'filter[status][in]': 'draft,published' }, POLICY)[0]?.value).toEqual([
      'draft',
      'published',
    ]);
  });

  it('in의 각 항목도 타입 변환을 거친다', () => {
    expect(parseFilters({ 'filter[category][in]': `${UUID},${UUID}` }, POLICY)[0]?.value).toEqual([
      UUID,
      UUID,
    ]);
  });

  it('isNull은 참거짓을 값으로 받는다', () => {
    expect(parseFilters({ 'filter[category][isNull]': 'true' }, POLICY)[0]?.value).toBe(true);
    expect(parseFilters({ 'filter[category][isNull]': 'false' }, POLICY)[0]?.value).toBe(false);
  });
});

describe('parseFilters 거부', () => {
  it('선언되지 않은 필드를 INVALID_FILTER로 거부한다', () => {
    const error = caught(() => parseFilters({ 'filter[secret]': 'x' }, POLICY));
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.source).toEqual({ parameter: 'filter[secret]' });
  });

  it('허용되지 않은 연산자를 거부한다', () => {
    const error = caught(() => parseFilters({ 'filter[title][gt]': 'x' }, POLICY));
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.source).toEqual({ parameter: 'filter[title][gt]' });
  });

  it('알 수 없는 연산자 이름을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[title][like]': 'x' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('같은 파라미터가 두 번 오면 거부한다', () => {
    // Node는 중복 키를 배열로 준다. 조용히 하나만 쓰면 어느 쪽이 적용됐는지 알 수 없다.
    expect(caught(() => parseFilters({ 'filter[title]': ['a', 'b'] }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('숫자가 아닌 number 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[size]': '삼' }, POLICY)).code).toBe('INVALID_FILTER');
  });

  it('참거짓이 아닌 boolean 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[active]': '1' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('UUID가 아닌 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[category]': 'not-a-uuid' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('ISO 8601이 아닌 timestamp를 거부한다', () => {
    // `new Date('2026')`은 통과해 버린다. 느슨한 파싱은 사용자가 의도한 범위와
    // 실제 범위를 조용히 갈라놓는다.
    expect(caught(() => parseFilters({ 'filter[createdAt][gte]': '2026' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
    expect(
      caught(() => parseFilters({ 'filter[createdAt][gte]': '2026-13-40T00:00:00Z' }, POLICY)).code,
    ).toBe('INVALID_FILTER');
  });

  it('enum에 없는 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[status]': 'unknown' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('in의 항목 하나만 틀려도 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[status][in]': 'draft,unknown' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('in에 빈 목록을 거부한다', () => {
    // 빈 IN은 언제나 거짓이라 결과가 항상 비는데, 사용자는 필터가 무시됐다고 읽는다.
    expect(caught(() => parseFilters({ 'filter[status][in]': '' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });

  it('isNull에 참거짓이 아닌 값을 거부한다', () => {
    expect(caught(() => parseFilters({ 'filter[category][isNull]': 'yes' }, POLICY)).code).toBe(
      'INVALID_FILTER',
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/filter.spec.ts`
Expected: FAIL — `Cannot find module '../../src/app/jsonapi/filter.js'`

- [ ] **Step 3: 구현한다**

`src/app/jsonapi/filter.ts`:

```ts
import type {
  FilterFieldPolicy,
  FilterOperator,
  QueryPolicy,
} from '../schemas/query-policy.js';
import { isFilterOperator } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `filter[...]` 질의 파라미터 해석.
 *
 * Express 5의 기본 query parser는 `'simple'`이라 `req.query`가 대괄호를 그대로 가진
 * 평평한 문자열 맵이다(`?filter[a][gt]=1` → `{ 'filter[a][gt]': '1' }`). 중첩 객체를
 * 기대하지 않는 이유가 그것이다.
 *
 * **열 이름은 언제나 정책에서 나온다.** 사용자가 보낸 필드 이름은 정책 표의 키를 찾는
 * 데만 쓰이고, 결과에 담기는 `property`는 표가 들고 있던 값이다.
 *
 * 값 변환은 느슨하게 하지 않는다. `new Date('2026')`처럼 통과해 버리는 파싱은
 * 사용자가 의도한 범위와 실제 범위를 조용히 갈라놓는다.
 */

/** 변환을 마친 스칼라 필터 값. */
export type ScalarFilterValue = string | number | boolean | Date;

/** 변환을 마친 필터 값. `in`은 배열, `isNull`은 참거짓이다. */
export type FilterValue = ScalarFilterValue | readonly ScalarFilterValue[];

/** 컴파일러에 넘길 조건 하나. */
export interface FilterCondition {
  /** 원본 질의 키. 오류의 `source.parameter`에 그대로 쓴다. */
  readonly parameter: string;
  /** 엔티티 프로퍼티 이름. 정책에서 온 값이다. */
  readonly property: string;
  readonly operator: FilterOperator;
  readonly value: FilterValue;
}

/** `filter[<field>]` 또는 `filter[<field>][<operator>]`. */
export const FILTER_KEY_PATTERN = /^filter\[([^[\]]+)\](?:\[([^[\]]+)\])?$/;

/** 이 키가 filter 파라미터인지 본다. */
export function isFilterKey(key: string): boolean {
  return FILTER_KEY_PATTERN.test(key);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;
// 날짜와 시각을 모두 요구한다. 오프셋은 `Z` 또는 `±HH:MM`.
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function invalidFilter(parameter: string, detail: string): JsonApiError {
  return new JsonApiError('INVALID_FILTER', { source: { parameter }, detail });
}

function toBoolean(raw: string, parameter: string): boolean {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw invalidFilter(parameter, 'expected "true" or "false"');
}

function toScalar(raw: string, field: FilterFieldPolicy, parameter: string): ScalarFilterValue {
  switch (field.type) {
    case 'string':
      return raw;
    case 'number': {
      if (!NUMBER_PATTERN.test(raw)) {
        throw invalidFilter(parameter, 'expected a number');
      }
      return Number(raw);
    }
    case 'boolean':
      return toBoolean(raw, parameter);
    case 'uuid': {
      if (!UUID_PATTERN.test(raw)) {
        throw invalidFilter(parameter, 'expected a UUID');
      }
      return raw;
    }
    case 'timestamp': {
      if (!TIMESTAMP_PATTERN.test(raw)) {
        throw invalidFilter(parameter, 'expected an ISO 8601 timestamp');
      }
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw invalidFilter(parameter, 'expected a valid ISO 8601 timestamp');
      }
      return parsed;
    }
    case 'enum': {
      const values = field.values ?? [];
      if (!values.includes(raw)) {
        throw invalidFilter(parameter, `expected one of: ${values.join(', ')}`);
      }
      return raw;
    }
  }
}

function readSingle(
  value: string | readonly string[] | undefined,
  parameter: string,
): string {
  if (typeof value === 'string') {
    return value;
  }
  // 같은 키가 두 번 오면 Node가 배열로 준다. 조용히 하나만 쓰면 어느 쪽이 적용됐는지
  // 사용자가 알 수 없다.
  throw invalidFilter(parameter, 'the parameter must be given exactly once');
}

function conditionFor(
  parameter: string,
  fieldName: string,
  operatorName: string,
  raw: string | readonly string[] | undefined,
  policy: QueryPolicy,
): FilterCondition {
  const field = policy.filters[fieldName];
  if (field === undefined) {
    throw invalidFilter(parameter, `"${fieldName}" is not a filterable field`);
  }
  if (!isFilterOperator(operatorName) || !field.operators.includes(operatorName)) {
    throw invalidFilter(parameter, `"${operatorName}" is not allowed on "${fieldName}"`);
  }

  const value = readSingle(raw, parameter);

  if (operatorName === 'isNull') {
    return { parameter, property: field.property, operator: 'isNull', value: toBoolean(value, parameter) };
  }

  if (operatorName === 'in') {
    // 빈 IN은 언제나 거짓이라 결과가 항상 비는데, 사용자는 필터가 무시됐다고 읽는다.
    if (value === '') {
      throw invalidFilter(parameter, 'the "in" operator requires at least one value');
    }
    const parts = value.split(',');
    return {
      parameter,
      property: field.property,
      operator: 'in',
      value: parts.map((part) => toScalar(part, field, parameter)),
    };
  }

  return {
    parameter,
    property: field.property,
    operator: operatorName,
    value: toScalar(value, field, parameter),
  };
}

/**
 * 질의 파라미터에서 필터 조건을 뽑는다.
 *
 * filter가 아닌 키는 그냥 지나친다 — 알 수 없는 파라미터를 거부하는 것은 `query.ts`의
 * 책임이고, 두 곳에서 하면 오류 코드가 갈라진다.
 */
export function parseFilters(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): FilterCondition[] {
  const conditions: FilterCondition[] = [];

  for (const [key, raw] of Object.entries(query)) {
    const matched = FILTER_KEY_PATTERN.exec(key);
    if (matched === null) {
      continue;
    }
    const fieldName = matched[1];
    if (fieldName === undefined) {
      continue;
    }
    conditions.push(conditionFor(key, fieldName, matched[2] ?? 'exact', raw, policy));
  }

  return conditions;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/filter.spec.ts`
Expected: PASS (28 tests)

- [ ] **Step 5: 린트와 타입을 확인한다**

Run: `pnpm exec eslint . && pnpm exec prettier --check . && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 모두 통과

- [ ] **Step 6: 커밋한다**

```bash
git add src/app/jsonapi/filter.ts test/jsonapi/filter.spec.ts
git commit -m "feat(jsonapi): filter 파싱과 저장 형식 변환 추가"
```

---
### Task 6: sort 파싱과 tie breaker 부착

**Files:**
- Create: `src/app/jsonapi/sort.ts`
- Test: `test/jsonapi/sort.spec.ts`

**Interfaces:**
- Consumes: `QueryPolicy`, `SortTerm`, `SortDirection` (Task 3); `JsonApiError`
- Produces:
  - `interface ResolvedSort { field: string; property: string; direction: SortDirection; nullable: boolean }`
  - `function parseSort(query: Readonly<Record<string, string | readonly string[] | undefined>>, policy: QueryPolicy): ResolvedSort[]`
  - `function sortSignature(sort: readonly ResolvedSort[]): string`

**계약:** `sort`가 없으면 정책의 `defaultSort`를 쓴다. 어느 쪽이든 마지막에 `tieBreaker`를 덧붙여 결과 순서를 전순서로 만든다 — 전순서가 아니면 같은 페이지를 두 번 요청했을 때 순서가 달라지고 keyset 커서가 행을 건너뛰거나 겹친다. `sort`가 이미 tie breaker 필드를 담고 있으면 덧붙이지 않는다.

`sortSignature`는 커서가 어떤 정렬에 묶였는지 나타내는 문자열이다. Task 9의 커서가 이 값을 담고, 요청의 정렬이 달라지면 `INVALID_PAGE`로 거부한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/sort.spec.ts`:

```ts
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { parseSort, sortSignature } from '../../src/app/jsonapi/sort.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {},
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
    title: { property: 'title', nullable: false },
    publishedAt: { property: 'publishedAt', nullable: true },
    id: { property: 'id', nullable: false },
  },
  includes: [],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('parseSort', () => {
  it('sort가 없으면 기본 정렬에 tie breaker를 붙인다', () => {
    expect(parseSort({}, POLICY)).toEqual([
      { field: 'createdAt', property: 'createdAt', direction: 'DESC', nullable: false },
      { field: 'id', property: 'id', direction: 'ASC', nullable: false },
    ]);
  });

  it('오름차순 필드를 해석한다', () => {
    expect(parseSort({ sort: 'title' }, POLICY)[0]).toEqual({
      field: 'title',
      property: 'title',
      direction: 'ASC',
      nullable: false,
    });
  });

  it('앞의 빼기표는 내림차순이다', () => {
    expect(parseSort({ sort: '-title' }, POLICY)[0]?.direction).toBe('DESC');
  });

  it('여러 필드를 순서대로 해석한다', () => {
    expect(parseSort({ sort: '-createdAt,title' }, POLICY).map((term) => term.field)).toEqual([
      'createdAt',
      'title',
      'id',
    ]);
  });

  it('공개 이름이 아니라 정책의 property를 실어 준다', () => {
    expect(parseSort({ sort: 'title' }, POLICY)[0]?.property).toBe('title');
  });

  it('nullable 표시를 정책에서 가져온다', () => {
    expect(parseSort({ sort: 'publishedAt' }, POLICY)[0]?.nullable).toBe(true);
  });

  it('tie breaker를 언제나 마지막에 붙인다', () => {
    // 전순서가 아니면 같은 페이지를 두 번 요청했을 때 순서가 달라진다.
    const terms = parseSort({ sort: 'title' }, POLICY);
    expect(terms[terms.length - 1]).toEqual({
      field: 'id',
      property: 'id',
      direction: 'ASC',
      nullable: false,
    });
  });

  it('이미 tie breaker 필드를 담고 있으면 덧붙이지 않는다', () => {
    const terms = parseSort({ sort: '-id' }, POLICY);
    expect(terms).toHaveLength(1);
    expect(terms[0]?.direction).toBe('DESC');
  });

  it('공백을 허용한다', () => {
    expect(parseSort({ sort: ' -createdAt , title ' }, POLICY).map((term) => term.field)).toEqual([
      'createdAt',
      'title',
      'id',
    ]);
  });
});

describe('parseSort 거부', () => {
  it('선언되지 않은 필드를 INVALID_SORT로 거부한다', () => {
    const error = caught(() => parseSort({ sort: 'secret' }, POLICY));
    expect(error.code).toBe('INVALID_SORT');
    expect(error.source).toEqual({ parameter: 'sort' });
  });

  it('빈 sort를 거부한다', () => {
    expect(caught(() => parseSort({ sort: '' }, POLICY)).code).toBe('INVALID_SORT');
    expect(caught(() => parseSort({ sort: ',' }, POLICY)).code).toBe('INVALID_SORT');
  });

  it('빼기표만 있는 항목을 거부한다', () => {
    expect(caught(() => parseSort({ sort: '-' }, POLICY)).code).toBe('INVALID_SORT');
  });

  it('같은 필드를 두 번 쓰면 거부한다', () => {
    // 뒤 항목은 절대 적용되지 않는데 사용자는 적용됐다고 읽는다.
    expect(caught(() => parseSort({ sort: 'title,-title' }, POLICY)).code).toBe('INVALID_SORT');
  });

  it('sort가 두 번 오면 거부한다', () => {
    expect(caught(() => parseSort({ sort: ['title', 'createdAt'] }, POLICY)).code).toBe(
      'INVALID_SORT',
    );
  });
});

describe('sortSignature', () => {
  it('필드와 방향을 순서대로 담는다', () => {
    expect(sortSignature(parseSort({ sort: '-createdAt' }, POLICY))).toBe('-createdAt,id');
  });

  it('정렬이 다르면 서명도 다르다', () => {
    // 커서는 이 서명에 묶인다. 정렬이 바뀐 뒤 커서를 재사용하면 거부해야 한다.
    expect(sortSignature(parseSort({ sort: 'title' }, POLICY))).not.toBe(
      sortSignature(parseSort({ sort: '-title' }, POLICY)),
    );
  });

  it('같은 정렬이면 서명이 같다', () => {
    expect(sortSignature(parseSort({}, POLICY))).toBe(
      sortSignature(parseSort({ sort: '-createdAt' }, POLICY)),
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/sort.spec.ts`
Expected: FAIL — `Cannot find module '../../src/app/jsonapi/sort.js'`

- [ ] **Step 3: 구현한다**

`src/app/jsonapi/sort.ts`:

```ts
import type { QueryPolicy, SortDirection } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `sort` 질의 파라미터 해석.
 *
 * 결과에는 언제나 정책의 tie breaker가 마지막에 붙는다. 전순서가 아니면 같은 페이지를
 * 두 번 요청했을 때 순서가 달라지고, keyset 커서는 그 위에서 행을 건너뛰거나 겹치게 낸다.
 */

/** 정책을 거쳐 프로퍼티까지 해석한 정렬 항목. */
export interface ResolvedSort {
  /** 공개 이름. 오류 메시지와 커서 서명에 쓴다. */
  readonly field: string;
  /** 엔티티 프로퍼티 이름. SQL에 들어가는 값이다. */
  readonly property: string;
  readonly direction: SortDirection;
  /** NULL을 허용하는 컬럼인가. keyset 커서가 이 표시를 보고 거부한다. */
  readonly nullable: boolean;
}

function invalidSort(detail: string): JsonApiError {
  return new JsonApiError('INVALID_SORT', { source: { parameter: 'sort' }, detail });
}

function resolve(field: string, direction: SortDirection, policy: QueryPolicy): ResolvedSort {
  const declared = policy.sorts[field];
  if (declared === undefined) {
    throw invalidSort(`"${field}" is not a sortable field`);
  }
  return { field, property: declared.property, direction, nullable: declared.nullable };
}

/**
 * 요청의 유효 정렬을 만든다.
 *
 * `sort`가 없으면 정책의 기본 정렬을 쓴다. 어느 쪽이든 tie breaker를 덧붙이되,
 * 이미 같은 필드가 있으면 사용자가 고른 방향을 존중해 덧붙이지 않는다.
 */
export function parseSort(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): ResolvedSort[] {
  const raw = query.sort;
  if (raw !== undefined && typeof raw !== 'string') {
    throw invalidSort('the parameter must be given exactly once');
  }

  const terms: ResolvedSort[] = [];
  const seen = new Set<string>();

  if (raw === undefined) {
    for (const term of policy.defaultSort) {
      terms.push(resolve(term.field, term.direction, policy));
      seen.add(term.field);
    }
  } else {
    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      const descending = trimmed.startsWith('-');
      const field = descending ? trimmed.slice(1) : trimmed;
      if (field === '') {
        throw invalidSort('an empty sort field is not allowed');
      }
      if (seen.has(field)) {
        throw invalidSort(`"${field}" is given more than once`);
      }
      seen.add(field);
      terms.push(resolve(field, descending ? 'DESC' : 'ASC', policy));
    }
  }

  if (!seen.has(policy.tieBreaker.field)) {
    terms.push(resolve(policy.tieBreaker.field, policy.tieBreaker.direction, policy));
  }

  return terms;
}

/**
 * 정렬을 문자열 하나로 요약한다.
 *
 * keyset 커서가 이 값을 담는다. 정렬을 바꾼 뒤 예전 커서를 재사용하면 서명이 어긋나고
 * `INVALID_PAGE`로 거부된다 — 그러지 않으면 커서가 다른 정렬 축의 값을 비교하게 되어
 * 결과가 조용히 어긋난다.
 */
export function sortSignature(sort: readonly ResolvedSort[]): string {
  return sort.map((term) => `${term.direction === 'DESC' ? '-' : ''}${term.field}`).join(',');
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/sort.spec.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/jsonapi/sort.ts test/jsonapi/sort.spec.ts
git commit -m "feat(jsonapi): sort 파싱과 tie breaker 부착 추가"
```

---

### Task 7: include 파싱

**Files:**
- Create: `src/app/jsonapi/include.ts`
- Test: `test/jsonapi/include.spec.ts`

**Interfaces:**
- Consumes: `QueryPolicy` (Task 3); `JsonApiError`
- Produces: `function parseInclude(query: Readonly<Record<string, string | readonly string[] | undefined>>, policy: QueryPolicy, declaredRelationships: readonly string[]): string[]`

**계약 (스펙 8.1):** `include` 경로는 **시리얼라이저 선언과 `QueryPolicy.includes` 양쪽**에서 허용되어야 한다. 한쪽만 허용하면 통과시키지 않는다 — 정책에만 있으면 직렬화할 방법이 없고, 시리얼라이저에만 있으면 정책이 열지 않기로 한 것이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/include.spec.ts`:

```ts
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { parseInclude } from '../../src/app/jsonapi/include.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {},
  sorts: { id: { property: 'id', nullable: false } },
  includes: ['category', 'tags'],
  defaultSort: [{ field: 'id', direction: 'ASC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

const DECLARED = ['category', 'tags'];

function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('parseInclude', () => {
  it('include가 없으면 빈 배열이다', () => {
    expect(parseInclude({}, POLICY, DECLARED)).toEqual([]);
  });

  it('빈 문자열은 아무것도 포함하지 않는다는 뜻이다', () => {
    expect(parseInclude({ include: '' }, POLICY, DECLARED)).toEqual([]);
  });

  it('한 경로를 해석한다', () => {
    expect(parseInclude({ include: 'category' }, POLICY, DECLARED)).toEqual(['category']);
  });

  it('쉼표로 나눈 여러 경로를 해석한다', () => {
    expect(parseInclude({ include: 'category,tags' }, POLICY, DECLARED)).toEqual([
      'category',
      'tags',
    ]);
  });

  it('공백을 허용한다', () => {
    expect(parseInclude({ include: ' category , tags ' }, POLICY, DECLARED)).toEqual([
      'category',
      'tags',
    ]);
  });

  it('같은 경로를 두 번 담지 않는다', () => {
    expect(parseInclude({ include: 'category,category' }, POLICY, DECLARED)).toEqual(['category']);
  });
});

describe('parseInclude 거부', () => {
  it('정책에 없는 경로를 INVALID_INCLUDE로 거부한다', () => {
    const error = caught(() => parseInclude({ include: 'secret' }, POLICY, DECLARED));
    expect(error.code).toBe('INVALID_INCLUDE');
    expect(error.source).toEqual({ parameter: 'include' });
  });

  it('정책이 열었어도 시리얼라이저가 선언하지 않았으면 거부한다', () => {
    // 스펙 8.1은 양쪽 모두를 요구한다. 정책만 보고 통과시키면 직렬화 단계에서
    // 터지고, 그 오류는 사용자 입력 오류가 아니라 500으로 나간다.
    expect(caught(() => parseInclude({ include: 'tags' }, POLICY, ['category'])).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('시리얼라이저가 선언했어도 정책이 열지 않았으면 거부한다', () => {
    const narrow: QueryPolicy = { ...POLICY, includes: ['category'] };
    expect(caught(() => parseInclude({ include: 'tags' }, narrow, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('중첩 경로는 허용 목록에 없으므로 거부된다', () => {
    // 이 템플릿의 허용 목록은 평평하다. 점이 든 경로는 목록에 없어 자연히 걸린다 —
    // 점을 특별히 다루는 규칙을 따로 두지 않는다.
    expect(caught(() => parseInclude({ include: 'category.parent' }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('빈 항목을 거부한다', () => {
    expect(caught(() => parseInclude({ include: 'category,' }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });

  it('include가 두 번 오면 거부한다', () => {
    expect(caught(() => parseInclude({ include: ['category', 'tags'] }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/include.spec.ts`
Expected: FAIL — `Cannot find module '../../src/app/jsonapi/include.js'`

- [ ] **Step 3: 구현한다**

`src/app/jsonapi/include.ts`:

```ts
import type { QueryPolicy } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `include` 질의 파라미터 해석.
 *
 * 스펙 8.1: 경로는 시리얼라이저의 관계 선언과 `QueryPolicy.includes` **양쪽**에서
 * 허용되어야 한다. 한쪽만 보고 통과시키면 두 선언이 갈라졌을 때 조용히 어긋난다 —
 * 정책에만 있으면 직렬화할 방법이 없어 500이 되고, 시리얼라이저에만 있으면 정책이
 * 열지 않기로 한 것을 뚫는다.
 *
 * 허용 목록은 평평하다. `category.parent` 같은 중첩 경로는 목록에 없으므로 자연히
 * 걸린다 — 점을 특별히 다루는 규칙을 따로 두지 않는다.
 */
function invalidInclude(detail: string): JsonApiError {
  return new JsonApiError('INVALID_INCLUDE', { source: { parameter: 'include' }, detail });
}

/** 요청이 요구한 include 경로를 정책과 시리얼라이저에 대조해 돌려준다. */
export function parseInclude(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
  declaredRelationships: readonly string[],
): string[] {
  const raw = query.include;
  if (raw === undefined) {
    return [];
  }
  if (typeof raw !== 'string') {
    throw invalidInclude('the parameter must be given exactly once');
  }
  if (raw.trim() === '') {
    return [];
  }

  const paths: string[] = [];
  for (const entry of raw.split(',')) {
    const path = entry.trim();
    if (path === '') {
      throw invalidInclude('an empty include path is not allowed');
    }
    if (!policy.includes.includes(path)) {
      throw invalidInclude(`"${path}" is not an includable path`);
    }
    if (!declaredRelationships.includes(path)) {
      throw invalidInclude(`"${path}" is not a declared relationship`);
    }
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }

  return paths;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/include.spec.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/jsonapi/include.ts test/jsonapi/include.spec.ts
git commit -m "feat(jsonapi): include 파싱을 시리얼라이저·정책 교집합으로 추가"
```

---
### Task 8: page 파라미터 파싱, probe 자르기, offset 링크

**Files:**
- Create: `src/app/jsonapi/pagination.ts`
- Test: `test/jsonapi/pagination.spec.ts`

**Interfaces:**
- Consumes: `QueryPolicy`, `MAX_PAGE_SIZE` (Task 3); `JsonApiError`
- Produces:
  - `type PageMode = 'offset' | 'cursor'`
  - `interface PageRequest { mode: PageMode; size: number; number?: number; after?: string; before?: string; totals: boolean }`
  - `interface PaginationLinks { self: string; first?: string; prev?: string; next?: string; last?: string }`
  - `interface ProbeResult<T> { items: readonly T[]; hasMore: boolean }`
  - `const PAGE_KEYS: readonly string[]`
  - `function isPageKey(key: string): boolean`
  - `function parsePage(query, policy): PageRequest`
  - `function probeLimit(page: PageRequest): number`
  - `function sliceProbe<T>(rows: readonly T[], page: PageRequest): ProbeResult<T>`
  - `function buildOffsetLinks(basePath, query, page, hasMore, totalCount): PaginationLinks`

**계약 (스펙 8.2):** 한 페이지 최대 100개. COUNT는 기본 실행하지 않고 한 행 더 읽어(probe) 다음 페이지 존재를 판정한다. `page[totals]=true`를 보낸 요청만 `meta.totalCount`와 `links.last`를 받고, 그 요청의 **모든 링크**가 `page[totals]=true`를 유지한다. `page[after]`/`page[before]`가 있으면 cursor 모드이며 `page[number]`와 함께 쓸 수 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/pagination.spec.ts`:

```ts
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  buildOffsetLinks,
  isPageKey,
  parsePage,
  probeLimit,
  sliceProbe,
} from '../../src/app/jsonapi/pagination.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: {},
  sorts: { id: { property: 'id', nullable: false } },
  includes: [],
  defaultSort: [{ field: 'id', direction: 'ASC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('isPageKey', () => {
  it('page 키를 알아본다', () => {
    expect(isPageKey('page[number]')).toBe(true);
    expect(isPageKey('page[after]')).toBe(true);
  });

  it('알 수 없는 page 키는 page 키가 아니다', () => {
    // query.ts의 allowlist가 이 값을 보고 INVALID_QUERY_PARAMETER로 거부한다.
    expect(isPageKey('page[offset]')).toBe(false);
    expect(isPageKey('page')).toBe(false);
    expect(isPageKey('sort')).toBe(false);
  });
});

describe('parsePage 기본값', () => {
  it('page가 없으면 offset 모드 1페이지다', () => {
    expect(parsePage({}, POLICY)).toEqual({ mode: 'offset', size: 25, number: 1, totals: false });
  });

  it('page[size]를 읽는다', () => {
    expect(parsePage({ 'page[size]': '10' }, POLICY).size).toBe(10);
  });

  it('page[number]를 읽는다', () => {
    expect(parsePage({ 'page[number]': '3' }, POLICY).number).toBe(3);
  });

  it('page[totals]=true를 읽는다', () => {
    expect(parsePage({ 'page[totals]': 'true' }, POLICY).totals).toBe(true);
    expect(parsePage({ 'page[totals]': 'false' }, POLICY).totals).toBe(false);
  });

  it('page[after]가 있으면 cursor 모드다', () => {
    expect(parsePage({ 'page[after]': 'abc' }, POLICY)).toEqual({
      mode: 'cursor',
      size: 25,
      after: 'abc',
      totals: false,
    });
  });

  it('빈 page[after]는 컬렉션 시작을 가리키는 진입점이다', () => {
    const page = parsePage({ 'page[after]': '' }, POLICY);
    expect(page.mode).toBe('cursor');
    expect(page.after).toBe('');
  });

  it('빈 page[before]는 컬렉션 끝을 가리키는 진입점이다', () => {
    const page = parsePage({ 'page[before]': '' }, POLICY);
    expect(page.mode).toBe('cursor');
    expect(page.before).toBe('');
  });
});

describe('parsePage 거부', () => {
  it('page[size]가 최대치를 넘으면 거부한다', () => {
    const error = caught(() => parsePage({ 'page[size]': '101' }, POLICY));
    expect(error.code).toBe('INVALID_PAGE');
    expect(error.source).toEqual({ parameter: 'page[size]' });
  });

  it('page[size]가 0 이하면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[size]': '0' }, POLICY)).code).toBe('INVALID_PAGE');
    expect(caught(() => parsePage({ 'page[size]': '-1' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('page[size]가 정수가 아니면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[size]': '2.5' }, POLICY)).code).toBe('INVALID_PAGE');
    expect(caught(() => parsePage({ 'page[size]': 'many' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('page[number]가 1보다 작으면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[number]': '0' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('page[totals]가 참거짓이 아니면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[totals]': '1' }, POLICY)).code).toBe('INVALID_PAGE');
  });

  it('after와 before를 함께 쓰면 거부한다', () => {
    const error = caught(() => parsePage({ 'page[after]': 'a', 'page[before]': 'b' }, POLICY));
    expect(error.code).toBe('INVALID_PAGE');
  });

  it('커서와 page[number]를 함께 쓰면 거부한다', () => {
    // 두 모드가 섞이면 어느 쪽이 적용됐는지 응답만 보고는 알 수 없다.
    expect(caught(() => parsePage({ 'page[after]': 'a', 'page[number]': '2' }, POLICY)).code).toBe(
      'INVALID_PAGE',
    );
  });

  it('같은 page 파라미터가 두 번 오면 거부한다', () => {
    expect(caught(() => parsePage({ 'page[size]': ['1', '2'] }, POLICY)).code).toBe('INVALID_PAGE');
  });
});

describe('probeLimit / sliceProbe', () => {
  it('요청 크기보다 한 행 더 읽는다', () => {
    // COUNT를 돌리지 않고 다음 페이지 존재를 판정하는 방법이다(스펙 8.2).
    expect(probeLimit(parsePage({ 'page[size]': '10' }, POLICY))).toBe(11);
  });

  it('한 행이 더 왔으면 hasMore가 참이고 그 행은 버린다', () => {
    const page = parsePage({ 'page[size]': '2' }, POLICY);
    expect(sliceProbe(['a', 'b', 'c'], page)).toEqual({ items: ['a', 'b'], hasMore: true });
  });

  it('꽉 차지 않았으면 hasMore가 거짓이다', () => {
    const page = parsePage({ 'page[size]': '2' }, POLICY);
    expect(sliceProbe(['a'], page)).toEqual({ items: ['a'], hasMore: false });
  });

  it('정확히 크기만큼 왔으면 hasMore가 거짓이다', () => {
    const page = parsePage({ 'page[size]': '2' }, POLICY);
    expect(sliceProbe(['a', 'b'], page)).toEqual({ items: ['a', 'b'], hasMore: false });
  });
});

describe('buildOffsetLinks', () => {
  const base = '/api/v1/examples';

  it('self와 first를 낸다', () => {
    const page = parsePage({}, POLICY);
    const links = buildOffsetLinks(base, {}, page, false, undefined);
    expect(links.self).toBe('/api/v1/examples?page[number]=1&page[size]=25');
    expect(links.first).toBe('/api/v1/examples?page[number]=1&page[size]=25');
  });

  it('첫 페이지에는 prev가 없다', () => {
    const links = buildOffsetLinks(base, {}, parsePage({}, POLICY), false, undefined);
    expect(links.prev).toBeUndefined();
  });

  it('다음 페이지가 없으면 next가 없다', () => {
    const links = buildOffsetLinks(base, {}, parsePage({}, POLICY), false, undefined);
    expect(links.next).toBeUndefined();
  });

  it('다음 페이지가 있으면 next를 낸다', () => {
    const query = { 'page[number]': '2', 'page[size]': '5' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), true, undefined);
    expect(links.next).toBe('/api/v1/examples?page[number]=3&page[size]=5');
    expect(links.prev).toBe('/api/v1/examples?page[number]=1&page[size]=5');
  });

  it('totals를 요청하지 않으면 last가 없다', () => {
    // COUNT를 돌리지 않았으므로 마지막 페이지 번호를 알 수 없다.
    const links = buildOffsetLinks(base, {}, parsePage({}, POLICY), true, undefined);
    expect(links.last).toBeUndefined();
  });

  it('totals를 요청하면 last를 내고 모든 링크가 totals를 유지한다', () => {
    const query = { 'page[size]': '10', 'page[totals]': 'true', 'page[number]': '2' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), true, 35);
    expect(links.last).toBe('/api/v1/examples?page[number]=4&page[size]=10&page[totals]=true');
    expect(links.self).toContain('page[totals]=true');
    expect(links.first).toContain('page[totals]=true');
    expect(links.prev).toContain('page[totals]=true');
    expect(links.next).toContain('page[totals]=true');
  });

  it('총 개수가 0이면 last는 1페이지다', () => {
    const query = { 'page[totals]': 'true' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), false, 0);
    expect(links.last).toBe('/api/v1/examples?page[number]=1&page[size]=25&page[totals]=true');
  });

  it('filter와 sort를 링크에 그대로 실어 나른다', () => {
    // 링크를 따라간 결과가 원래 요청과 다른 집합이면 페이지네이션이 깨진 것이다.
    const query = { 'filter[status]': 'draft', sort: '-createdAt' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), true, undefined);
    expect(links.next).toContain('filter[status]=draft');
    expect(links.next).toContain('sort=-createdAt');
  });

  it('값을 URL 인코딩한다', () => {
    const query = { 'filter[title]': '가 나' };
    const links = buildOffsetLinks(base, query, parsePage(query, POLICY), false, undefined);
    expect(links.self).toContain('filter[title]=%EA%B0%80%20%EB%82%98');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/pagination.spec.ts`
Expected: FAIL — `Cannot find module '../../src/app/jsonapi/pagination.js'`

- [ ] **Step 3: 구현한다**

`src/app/jsonapi/pagination.ts`:

```ts
import { MAX_PAGE_SIZE } from '../schemas/query-policy.js';
import type { QueryPolicy } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';

/**
 * `page[...]` 파라미터 해석과 링크 조립.
 *
 * 목록 응답은 COUNT를 기본 실행하지 않는다. 요청 크기보다 한 행 더 읽어(probe) 다음
 * 페이지가 있는지 판정하고, 그 한 행은 응답에서 버린다. COUNT는 큰 테이블에서 목록
 * 조회보다 비싸질 수 있어서, 필요하다고 말한 요청(`page[totals]=true`)에만 돌린다.
 */

/** 페이지네이션 모드. */
export type PageMode = 'offset' | 'cursor';

/** 해석을 마친 페이지 요청. */
export interface PageRequest {
  readonly mode: PageMode;
  readonly size: number;
  /** offset 모드의 1-기반 페이지 번호. */
  readonly number?: number;
  /** cursor 모드의 진입점. 빈 문자열은 컬렉션의 시작을 가리킨다. */
  readonly after?: string;
  /** cursor 모드의 진입점. 빈 문자열은 컬렉션의 끝을 가리킨다. */
  readonly before?: string;
  readonly totals: boolean;
}

/** 페이지 링크. 낼 수 없는 링크는 멤버째 생략한다. */
export interface PaginationLinks {
  readonly self: string;
  readonly first?: string;
  readonly prev?: string;
  readonly next?: string;
  readonly last?: string;
}

/** probe로 한 행 더 읽은 결과를 자른 것. */
export interface ProbeResult<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}

/** 이 저장소가 아는 page 파라미터. 목록에 없는 `page[...]`는 알 수 없는 파라미터다. */
export const PAGE_KEYS: readonly string[] = [
  'page[number]',
  'page[size]',
  'page[after]',
  'page[before]',
  'page[totals]',
];

/** 이 키가 알려진 page 파라미터인지 본다. */
export function isPageKey(key: string): boolean {
  return PAGE_KEYS.includes(key);
}

const INTEGER_PATTERN = /^-?\d+$/;

function invalidPage(parameter: string, detail: string): JsonApiError {
  return new JsonApiError('INVALID_PAGE', { source: { parameter }, detail });
}

function single(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  key: string,
): string | undefined {
  const raw = query[key];
  if (raw === undefined || typeof raw === 'string') {
    return raw;
  }
  throw invalidPage(key, 'the parameter must be given exactly once');
}

function integer(raw: string, key: string): number {
  if (!INTEGER_PATTERN.test(raw)) {
    throw invalidPage(key, 'expected an integer');
  }
  return Number.parseInt(raw, 10);
}

/** 질의 파라미터에서 페이지 요청을 만든다. */
export function parsePage(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): PageRequest {
  const rawSize = single(query, 'page[size]');
  const rawNumber = single(query, 'page[number]');
  const rawTotals = single(query, 'page[totals]');
  const after = single(query, 'page[after]');
  const before = single(query, 'page[before]');

  let size = policy.defaultPageSize;
  if (rawSize !== undefined) {
    size = integer(rawSize, 'page[size]');
    if (size < 1) {
      throw invalidPage('page[size]', 'the page size must be at least 1');
    }
    if (size > MAX_PAGE_SIZE) {
      throw invalidPage('page[size]', `the page size must be at most ${String(MAX_PAGE_SIZE)}`);
    }
  }

  let totals = false;
  if (rawTotals !== undefined) {
    if (rawTotals !== 'true' && rawTotals !== 'false') {
      throw invalidPage('page[totals]', 'expected "true" or "false"');
    }
    totals = rawTotals === 'true';
  }

  if (after !== undefined && before !== undefined) {
    throw invalidPage('page[after]', 'page[after] and page[before] cannot be combined');
  }

  const cursor = after ?? before;
  if (cursor !== undefined) {
    // 두 모드가 섞이면 어느 쪽이 적용됐는지 응답만 보고는 알 수 없다.
    if (rawNumber !== undefined) {
      throw invalidPage('page[number]', 'a cursor cannot be combined with page[number]');
    }
    return {
      mode: 'cursor',
      size,
      totals,
      ...(after === undefined ? { before } : { after }),
    };
  }

  let number = 1;
  if (rawNumber !== undefined) {
    number = integer(rawNumber, 'page[number]');
    if (number < 1) {
      throw invalidPage('page[number]', 'the page number must be at least 1');
    }
  }

  return { mode: 'offset', size, number, totals };
}

/** 실제로 읽을 행 수. 다음 페이지 판정을 위해 한 행을 더 읽는다. */
export function probeLimit(page: PageRequest): number {
  return page.size + 1;
}

/** probe로 읽은 행을 요청 크기만큼 자르고 다음 페이지 존재를 판정한다. */
export function sliceProbe<T>(rows: readonly T[], page: PageRequest): ProbeResult<T> {
  if (rows.length > page.size) {
    return { items: rows.slice(0, page.size), hasMore: true };
  }
  return { items: rows, hasMore: false };
}

/**
 * 질의 키를 인코딩하되 대괄호는 남긴다.
 *
 * `filter[title]`이 `filter%5Btitle%5D`로 나가도 서버는 읽지만, JSON:API 규격의 예시와
 * 실제로 오가는 링크가 눈으로 대조되지 않는다. 대괄호는 사실상 모든 클라이언트가
 * 그대로 받아들인다.
 */
function encodeKey(key: string): string {
  return encodeURIComponent(key).replace(/%5B/g, '[').replace(/%5D/g, ']');
}

function toQueryString(pairs: readonly (readonly [string, string])[]): string {
  return pairs
    .map(([key, value]) => `${encodeKey(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** page 파라미터를 뺀 나머지를 원래 모습 그대로 모은다. */
function preservedPairs(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('page[') || value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      pairs.push([key, value]);
      continue;
    }
    for (const entry of value) {
      pairs.push([key, entry]);
    }
  }
  return pairs;
}

/**
 * offset 모드의 페이지 링크를 만든다.
 *
 * `page[totals]=true`를 보낸 요청은 모든 링크가 그 값을 유지한다 — 링크를 따라갔을 때
 * `meta.totalCount`가 사라지면 클라이언트가 페이지 수를 잃는다.
 *
 * `last`는 총 개수를 아는 요청에만 낸다. COUNT를 돌리지 않았으면 마지막 페이지 번호를
 * 알 방법이 없고, 모르면서 지어내는 링크는 없는 것만 못하다.
 */
export function buildOffsetLinks(
  basePath: string,
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  page: PageRequest,
  hasMore: boolean,
  totalCount: number | undefined,
): PaginationLinks {
  const preserved = preservedPairs(query);
  const current = page.number ?? 1;

  const link = (pageNumber: number): string => {
    const pairs: (readonly [string, string])[] = [
      ...preserved,
      ['page[number]', String(pageNumber)],
      ['page[size]', String(page.size)],
      ...(page.totals ? [['page[totals]', 'true'] as const] : []),
    ];
    return `${basePath}?${toQueryString(pairs)}`;
  };

  const links: {
    self: string;
    first?: string;
    prev?: string;
    next?: string;
    last?: string;
  } = { self: link(current), first: link(1) };

  if (current > 1) {
    links.prev = link(current - 1);
  }
  if (hasMore) {
    links.next = link(current + 1);
  }
  if (page.totals && totalCount !== undefined) {
    links.last = link(Math.max(1, Math.ceil(totalCount / page.size)));
  }

  return links;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/pagination.spec.ts`
Expected: PASS (29 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/jsonapi/pagination.ts test/jsonapi/pagination.spec.ts
git commit -m "feat(jsonapi): page 파싱과 probe 기반 offset 페이지네이션 추가"
```

---

### Task 9: keyset 커서

**Files:**
- Create: `src/app/jsonapi/cursor.ts`
- Modify: `src/app/jsonapi/pagination.ts` (`buildCursorLinks` 추가)
- Test: `test/jsonapi/cursor.spec.ts`

**Interfaces:**
- Consumes: `ResolvedSort`, `sortSignature` (Task 6); `PageRequest`, `PaginationLinks` (Task 8); `JsonApiError`
- Produces:
  - `function encodeCursor(signature: string, values: readonly string[]): string`
  - `function decodeCursor(raw: string, expectedSignature: string, expectedLength: number): readonly string[]`
  - `interface KeysetPredicate { clause: string; parameters: Record<string, string> }`
  - `function keysetPredicate(alias: string, sort: readonly ResolvedSort[], values: readonly string[], direction: 'after' | 'before'): KeysetPredicate`
  - `function assertCursorSortable(sort: readonly ResolvedSort[]): void`
  - `function buildCursorLinks(basePath, query, page, firstCursor, lastCursor, hasMore): PaginationLinks` (pagination.ts)

**계약 (스펙 8.2):** 커서는 요청의 유효 정렬에 묶인다. 정렬 변경 후 재사용, 손상된 커서, `after`/`before` 동시 사용, 커서와 `page[number]` 동시 사용은 모두 `400 INVALID_PAGE`. NULL을 허용하는 정렬 컬럼은 keyset 비교가 행을 건너뛰므로 `INVALID_PAGE`로 거부한다.

**비교식:** 방향이 섞일 수 있으므로 행 값 비교(`(a,b) > (x,y)`)를 쓰지 않고 사전식으로 펼친다.

```
(t1 ≻ v1) OR (t1 = v1 AND t2 ≻ v2) OR (t1 = v1 AND t2 = v2 AND t3 ≻ v3) ...
```

`≻`는 `after`에서 ASC면 `>`, DESC면 `<`이고 `before`에서는 뒤집힌다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/cursor.spec.ts`:

```ts
import {
  assertCursorSortable,
  decodeCursor,
  encodeCursor,
  keysetPredicate,
} from '../../src/app/jsonapi/cursor.js';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import type { ResolvedSort } from '../../src/app/jsonapi/sort.js';

const SORT: ResolvedSort[] = [
  { field: 'createdAt', property: 'createdAt', direction: 'DESC', nullable: false },
  { field: 'id', property: 'id', direction: 'ASC', nullable: false },
];

const SIGNATURE = '-createdAt,id';

function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('encodeCursor / decodeCursor', () => {
  it('왕복한다', () => {
    const cursor = encodeCursor(SIGNATURE, ['2026-08-30T00:00:00.000Z', 'e1']);
    expect(decodeCursor(cursor, SIGNATURE, 2)).toEqual(['2026-08-30T00:00:00.000Z', 'e1']);
  });

  it('URL에 그대로 넣을 수 있는 문자만 쓴다', () => {
    const cursor = encodeCursor(SIGNATURE, ['가 나', 'e1']);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('정렬이 달라진 커서를 거부한다', () => {
    // 커서를 다른 정렬 축에 대고 비교하면 결과가 조용히 어긋난다.
    const cursor = encodeCursor('title,id', ['제목', 'e1']);
    const error = caught(() => decodeCursor(cursor, SIGNATURE, 2));
    expect(error.code).toBe('INVALID_PAGE');
    expect(error.source).toEqual({ parameter: 'page[after]' });
  });

  it('항목 수가 정렬과 다른 커서를 거부한다', () => {
    const cursor = encodeCursor(SIGNATURE, ['2026-08-30T00:00:00.000Z']);
    expect(caught(() => decodeCursor(cursor, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('base64url이 아닌 문자열을 거부한다', () => {
    expect(caught(() => decodeCursor('!!!not-base64!!!', SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('JSON이 아닌 커서를 거부한다', () => {
    const broken = Buffer.from('그냥 글자', 'utf8').toString('base64url');
    expect(caught(() => decodeCursor(broken, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('모양이 다른 JSON 커서를 거부한다', () => {
    const broken = Buffer.from(JSON.stringify({ sort: SIGNATURE }), 'utf8').toString('base64url');
    expect(caught(() => decodeCursor(broken, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('값에 문자열이 아닌 것이 섞이면 거부한다', () => {
    const broken = Buffer.from(
      JSON.stringify({ sort: SIGNATURE, values: ['a', 3] }),
      'utf8',
    ).toString('base64url');
    expect(caught(() => decodeCursor(broken, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('빈 커서를 거부한다', () => {
    expect(caught(() => decodeCursor('', SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });
});

describe('assertCursorSortable', () => {
  it('NULL을 허용하지 않는 정렬은 통과한다', () => {
    expect(() => {
      assertCursorSortable(SORT);
    }).not.toThrow();
  });

  it('nullable 정렬 컬럼을 INVALID_PAGE로 거부한다', () => {
    // keyset 비교에 NULL이 섞이면 비교가 unknown이 되어 행을 조용히 건너뛴다.
    const nullable: ResolvedSort[] = [
      { field: 'publishedAt', property: 'publishedAt', direction: 'ASC', nullable: true },
      ...SORT.slice(1),
    ];
    const error = caught(() => {
      assertCursorSortable(nullable);
    });
    expect(error.code).toBe('INVALID_PAGE');
  });
});

describe('keysetPredicate', () => {
  it('after는 정렬 방향대로 부등호를 고른다', () => {
    const predicate = keysetPredicate('e', SORT, ['2026-08-30T00:00:00.000Z', 'e1'], 'after');
    // createdAt DESC이므로 뒤로 가려면 더 작은 값, id ASC이므로 더 큰 값.
    expect(predicate.clause).toBe(
      '((e.createdAt < :cursor0) OR (e.createdAt = :cursor0 AND e.id > :cursor1))',
    );
    expect(predicate.parameters).toEqual({
      cursor0: '2026-08-30T00:00:00.000Z',
      cursor1: 'e1',
    });
  });

  it('before는 부등호를 뒤집는다', () => {
    const predicate = keysetPredicate('e', SORT, ['2026-08-30T00:00:00.000Z', 'e1'], 'before');
    expect(predicate.clause).toBe(
      '((e.createdAt > :cursor0) OR (e.createdAt = :cursor0 AND e.id < :cursor1))',
    );
  });

  it('정렬 항목이 하나면 비교도 하나다', () => {
    const single: ResolvedSort[] = [
      { field: 'id', property: 'id', direction: 'ASC', nullable: false },
    ];
    expect(keysetPredicate('e', single, ['e1'], 'after').clause).toBe('((e.id > :cursor0))');
  });

  it('정렬 항목이 셋이면 사전식으로 펼친다', () => {
    const three: ResolvedSort[] = [
      { field: 'a', property: 'a', direction: 'ASC', nullable: false },
      { field: 'b', property: 'b', direction: 'DESC', nullable: false },
      { field: 'id', property: 'id', direction: 'ASC', nullable: false },
    ];
    expect(keysetPredicate('e', three, ['1', '2', '3'], 'after').clause).toBe(
      '((e.a > :cursor0) OR (e.a = :cursor0 AND e.b < :cursor1) OR ' +
        '(e.a = :cursor0 AND e.b = :cursor1 AND e.id > :cursor2))',
    );
  });

  it('컬럼 이름은 정렬 항목의 property에서만 나온다', () => {
    // 사용자 입력이 열 이름이 되는 경로가 없다는 것을 고정한다.
    const predicate = keysetPredicate('e', SORT, ['x', 'y'], 'after');
    expect(predicate.clause).not.toContain('createdAtField');
    expect(predicate.clause).toContain('e.createdAt');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/cursor.spec.ts`
Expected: FAIL — `Cannot find module '../../src/app/jsonapi/cursor.js'`

- [ ] **Step 3: 구현한다**

`src/app/jsonapi/cursor.ts`:

```ts
import { JsonApiError } from './errors.js';
import type { ResolvedSort } from './sort.js';

/**
 * keyset(cursor) 페이지네이션의 커서.
 *
 * 커서는 "마지막으로 본 행의 정렬 키 값"이다. OFFSET과 달리 앞쪽 행이 지워지거나
 * 끼어들어도 같은 지점을 가리키므로, 큰 컬렉션을 훑는 동안 행을 건너뛰거나 두 번 보는
 * 일이 없다.
 *
 * 커서는 **그 커서를 만든 정렬에 묶인다**. 정렬을 바꾼 뒤 예전 커서를 쓰면 다른 축의
 * 값을 비교하게 되어 결과가 조용히 어긋나므로, 서명이 다르면 거부한다.
 */

interface CursorPayload {
  readonly sort: string;
  readonly values: readonly string[];
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function invalidCursor(detail: string): JsonApiError {
  // `source`는 언제나 `page[after]`로 둔다. `before`로 온 커서도 같은 규칙을 어긴
  // 것이고, 두 파라미터를 갈라 적으면 오류 문구만 늘고 진단은 나아지지 않는다.
  return new JsonApiError('INVALID_PAGE', { source: { parameter: 'page[after]' }, detail });
}

/** 정렬 서명과 값으로 커서를 만든다. */
export function encodeCursor(signature: string, values: readonly string[]): string {
  const payload: CursorPayload = { sort: signature, values };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function readPayload(raw: string): CursorPayload {
  if (raw === '' || !BASE64URL_PATTERN.test(raw)) {
    throw invalidCursor('the cursor is malformed');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor('the cursor is malformed');
  }

  if (typeof parsed !== 'object' || parsed === null || !('sort' in parsed) || !('values' in parsed)) {
    throw invalidCursor('the cursor is malformed');
  }
  const sort = parsed.sort;
  const values = parsed.values;
  if (typeof sort !== 'string' || !Array.isArray(values)) {
    throw invalidCursor('the cursor is malformed');
  }
  const entries: unknown[] = values;
  if (!entries.every((entry) => typeof entry === 'string')) {
    throw invalidCursor('the cursor is malformed');
  }
  // `every`가 좁혀 주지 않으므로 한 번 더 걸러 문자열 배열을 만든다.
  const strings = entries.filter((entry): entry is string => typeof entry === 'string');
  return { sort, values: strings };
}

/**
 * 커서를 해석하고 이번 요청의 정렬과 맞는지 확인한다.
 *
 * 서명이 다르거나 항목 수가 다르면 `INVALID_PAGE`다.
 */
export function decodeCursor(
  raw: string,
  expectedSignature: string,
  expectedLength: number,
): readonly string[] {
  const payload = readPayload(raw);
  if (payload.sort !== expectedSignature) {
    throw invalidCursor('the cursor was issued for a different sort order');
  }
  if (payload.values.length !== expectedLength) {
    throw invalidCursor('the cursor does not match the current sort order');
  }
  return payload.values;
}

/**
 * 이 정렬로 keyset 커서를 쓸 수 있는지 확인한다.
 *
 * NULL을 허용하는 컬럼이 섞이면 `컬럼 > 값` 비교가 NULL 행에서 unknown이 되어 그 행이
 * 조용히 빠진다. 조용히 빠지느니 거부한다(스펙 8.2).
 */
export function assertCursorSortable(sort: readonly ResolvedSort[]): void {
  for (const term of sort) {
    if (term.nullable) {
      throw invalidCursor(`cursor pagination cannot be used with the nullable sort "${term.field}"`);
    }
  }
}

/** keyset 비교식과 그 파라미터. */
export interface KeysetPredicate {
  readonly clause: string;
  readonly parameters: Record<string, string>;
}

/**
 * 사전식 keyset 비교식을 만든다.
 *
 * 행 값 비교(`(a, b) > (x, y)`)는 모든 컬럼의 정렬 방향이 같을 때만 맞다. 이 템플릿은
 * 방향이 섞인 정렬을 허용하므로 사전식으로 펼친다.
 *
 * 컬럼 이름은 `ResolvedSort.property`에서만 나온다 — 그 값은 정책 allowlist를 거친
 * 것이므로 사용자 입력이 열 이름이 되는 경로가 없다.
 */
export function keysetPredicate(
  alias: string,
  sort: readonly ResolvedSort[],
  values: readonly string[],
  direction: 'after' | 'before',
): KeysetPredicate {
  const parameters: Record<string, string> = {};
  values.forEach((value, index) => {
    parameters[`cursor${String(index)}`] = value;
  });

  const branches: string[] = [];
  for (let index = 0; index < sort.length; index += 1) {
    const term = sort[index];
    if (term === undefined) {
      continue;
    }
    const ascending = term.direction === 'ASC';
    const forward = direction === 'after' ? ascending : !ascending;
    const comparison = forward ? '>' : '<';

    const equalities: string[] = [];
    for (let previous = 0; previous < index; previous += 1) {
      const earlier = sort[previous];
      if (earlier === undefined) {
        continue;
      }
      equalities.push(`${alias}.${earlier.property} = :cursor${String(previous)}`);
    }
    equalities.push(`${alias}.${term.property} ${comparison} :cursor${String(index)}`);
    branches.push(`(${equalities.join(' AND ')})`);
  }

  return { clause: `(${branches.join(' OR ')})`, parameters };
}
```

- [ ] **Step 4: cursor 링크 생성기를 pagination.ts에 더한다**

`src/app/jsonapi/pagination.ts` 끝에 추가한다.

```ts
/**
 * cursor 모드의 페이지 링크를 만든다.
 *
 * offset 모드와 달리 `first`와 `last`를 빈 진입점으로 낸다 — `page[after]=`는 컬렉션의
 * 시작, `page[before]=`는 끝을 가리킨다. 총 개수를 모르고도 양 끝으로 갈 수 있다.
 *
 * `prev`/`next`는 이번 페이지의 첫 행과 마지막 행에서 만든 커서다. 페이지가 비었으면
 * 만들 커서가 없으므로 둘 다 내지 않는다.
 */
export function buildCursorLinks(
  basePath: string,
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  page: PageRequest,
  firstCursor: string | undefined,
  lastCursor: string | undefined,
  hasMore: boolean,
): PaginationLinks {
  const preserved = preservedPairs(query);

  const link = (pageParams: readonly (readonly [string, string])[]): string => {
    const pairs: (readonly [string, string])[] = [
      ...preserved,
      ...pageParams,
      ['page[size]', String(page.size)],
      ...(page.totals ? [['page[totals]', 'true'] as const] : []),
    ];
    return `${basePath}?${toQueryString(pairs)}`;
  };

  const selfParams: (readonly [string, string])[] =
    page.after !== undefined ? [['page[after]', page.after]] : [['page[before]', page.before ?? '']];

  const links: {
    self: string;
    first?: string;
    prev?: string;
    next?: string;
    last?: string;
  } = {
    self: link(selfParams),
    first: link([['page[after]', '']]),
    last: link([['page[before]', '']]),
  };

  if (firstCursor !== undefined) {
    links.prev = link([['page[before]', firstCursor]]);
  }
  if (hasMore && lastCursor !== undefined) {
    links.next = link([['page[after]', lastCursor]]);
  }

  return links;
}
```

- [ ] **Step 5: cursor 링크 테스트를 더한다**

`test/jsonapi/pagination.spec.ts` 끝에 붙인다. 파일 위쪽 import에 `buildCursorLinks`를 더한다.

```ts
describe('buildCursorLinks', () => {
  const base = '/api/v1/examples';

  it('first와 last를 빈 진입점으로 낸다', () => {
    const query = { 'page[after]': '' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), undefined, undefined, false);
    expect(links.first).toBe('/api/v1/examples?page[after]=&page[size]=25');
    expect(links.last).toBe('/api/v1/examples?page[before]=&page[size]=25');
  });

  it('다음 페이지가 있으면 마지막 행의 커서로 next를 낸다', () => {
    const query = { 'page[after]': '' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), 'AAA', 'ZZZ', true);
    expect(links.next).toBe('/api/v1/examples?page[after]=ZZZ&page[size]=25');
    expect(links.prev).toBe('/api/v1/examples?page[before]=AAA&page[size]=25');
  });

  it('다음 페이지가 없으면 next를 내지 않는다', () => {
    const query = { 'page[after]': '' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), 'AAA', 'ZZZ', false);
    expect(links.next).toBeUndefined();
  });

  it('페이지가 비면 prev도 next도 없다', () => {
    const query = { 'page[after]': 'X' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), undefined, undefined, false);
    expect(links.prev).toBeUndefined();
    expect(links.next).toBeUndefined();
  });

  it('filter를 링크에 실어 나른다', () => {
    const query = { 'page[after]': '', 'filter[status]': 'draft' };
    const links = buildCursorLinks(base, query, parsePage(query, POLICY), undefined, 'Z', true);
    expect(links.next).toContain('filter[status]=draft');
  });
});
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi`
Expected: PASS

- [ ] **Step 7: 커밋한다**

```bash
git add src/app/jsonapi/cursor.ts src/app/jsonapi/pagination.ts test/jsonapi/cursor.spec.ts test/jsonapi/pagination.spec.ts
git commit -m "feat(jsonapi): keyset 커서와 cursor 모드 링크 추가"
```

---
### Task 10: 질의 파라미터 전체 검증과 조립

**Files:**
- Create: `src/app/jsonapi/query.ts`
- Test: `test/jsonapi/query.spec.ts`

**Interfaces:**
- Consumes: `parseFilters`, `isFilterKey`, `FilterCondition` (Task 5); `parseSort`, `ResolvedSort` (Task 6); `parseInclude` (Task 7); `parsePage`, `isPageKey`, `PageRequest` (Task 8); `QueryPolicy`
- Produces:
  - `interface ParsedQuery { filters: readonly FilterCondition[]; sort: readonly ResolvedSort[]; include: readonly string[]; page: PageRequest }`
  - `function parseQuery(query, policy, declaredRelationships): ParsedQuery`
  - `function parseRelatedCollectionQuery(query, policy): PageRequest`
  - `function assertNoQueryParameters(query): void`

**계약 (스펙 8.1·8.2):** 알 수 없는 파라미터와 `fields[...]`는 JSON:API 오류로 거부한다. 관계 URL은 to-many가 `page[number]`/`page[size]`만 받고, to-one은 모든 조회 파라미터를 거부한다.

**검증 순서:** 알 수 없는 파라미터를 먼저 본다. 오타 난 파라미터가 조용히 무시되는 것이 이 계층에서 가장 흔한 사고이고, 그것을 먼저 말해 주는 편이 filter 값 오류보다 진단에 도움이 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/jsonapi/query.spec.ts`:

```ts
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import {
  assertNoQueryParameters,
  parseQuery,
  parseRelatedCollectionQuery,
} from '../../src/app/jsonapi/query.js';
import type { QueryPolicy } from '../../src/app/schemas/query-policy.js';

const POLICY: QueryPolicy = {
  filters: { status: { property: 'status', type: 'string', operators: ['exact'] } },
  sorts: {
    createdAt: { property: 'createdAt', nullable: false },
    id: { property: 'id', nullable: false },
  },
  includes: ['category'],
  defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
  tieBreaker: { field: 'id', direction: 'ASC' },
  defaultPageSize: 25,
};

const DECLARED = ['category', 'tags'];

function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('parseQuery', () => {
  it('빈 질의도 기본 정렬과 기본 페이지를 낸다', () => {
    const parsed = parseQuery({}, POLICY, DECLARED);
    expect(parsed.filters).toEqual([]);
    expect(parsed.include).toEqual([]);
    expect(parsed.sort.map((term) => term.field)).toEqual(['createdAt', 'id']);
    expect(parsed.page).toEqual({ mode: 'offset', size: 25, number: 1, totals: false });
  });

  it('네 갈래를 함께 해석한다', () => {
    const parsed = parseQuery(
      {
        'filter[status]': 'draft',
        sort: '-createdAt',
        include: 'category',
        'page[size]': '5',
      },
      POLICY,
      DECLARED,
    );
    expect(parsed.filters).toHaveLength(1);
    expect(parsed.include).toEqual(['category']);
    expect(parsed.page.size).toBe(5);
  });
});

describe('parseQuery 거부', () => {
  it('알 수 없는 파라미터를 INVALID_QUERY_PARAMETER로 거부한다', () => {
    const error = caught(() => parseQuery({ q: '검색어' }, POLICY, DECLARED));
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'q' });
  });

  it('fields[...]를 거부한다', () => {
    // 희소 필드셋은 스펙 1.1의 비목표다. 조용히 무시하면 클라이언트는 적용됐다고 읽는다.
    const error = caught(() => parseQuery({ 'fields[examples]': 'title' }, POLICY, DECLARED));
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'fields[examples]' });
  });

  it('알 수 없는 page 하위 키를 거부한다', () => {
    expect(caught(() => parseQuery({ 'page[offset]': '10' }, POLICY, DECLARED)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
  });

  it('알 수 없는 파라미터를 값 오류보다 먼저 말한다', () => {
    // 오타 난 파라미터가 조용히 무시되는 것이 가장 흔한 사고다.
    const error = caught(() =>
      parseQuery({ q: '검색어', 'filter[status][gt]': 'x' }, POLICY, DECLARED),
    );
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
  });

  it('filter·sort·include·page 오류는 각자의 코드로 낸다', () => {
    expect(caught(() => parseQuery({ 'filter[secret]': 'x' }, POLICY, DECLARED)).code).toBe(
      'INVALID_FILTER',
    );
    expect(caught(() => parseQuery({ sort: 'secret' }, POLICY, DECLARED)).code).toBe('INVALID_SORT');
    expect(caught(() => parseQuery({ include: 'secret' }, POLICY, DECLARED)).code).toBe(
      'INVALID_INCLUDE',
    );
    expect(caught(() => parseQuery({ 'page[size]': '0' }, POLICY, DECLARED)).code).toBe(
      'INVALID_PAGE',
    );
  });
});

describe('parseRelatedCollectionQuery', () => {
  it('page[number]와 page[size]만 받는다', () => {
    expect(parseRelatedCollectionQuery({ 'page[number]': '2', 'page[size]': '5' }, POLICY)).toEqual({
      mode: 'offset',
      size: 5,
      number: 2,
      totals: true,
    });
  });

  it('총 개수를 언제나 낸다', () => {
    // 스펙 8.2: to-many 관계 URL은 meta.totalCount와 페이지 링크를 반환한다.
    expect(parseRelatedCollectionQuery({}, POLICY).totals).toBe(true);
  });

  it('filter를 거부한다', () => {
    const error = caught(() => parseRelatedCollectionQuery({ 'filter[status]': 'draft' }, POLICY));
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'filter[status]' });
  });

  it('sort와 include를 거부한다', () => {
    expect(caught(() => parseRelatedCollectionQuery({ sort: 'createdAt' }, POLICY)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
    expect(caught(() => parseRelatedCollectionQuery({ include: 'category' }, POLICY)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
  });

  it('커서 파라미터를 거부한다', () => {
    expect(caught(() => parseRelatedCollectionQuery({ 'page[after]': '' }, POLICY)).code).toBe(
      'INVALID_QUERY_PARAMETER',
    );
  });
});

describe('assertNoQueryParameters', () => {
  it('파라미터가 없으면 통과한다', () => {
    expect(() => {
      assertNoQueryParameters({});
    }).not.toThrow();
  });

  it('어떤 파라미터든 거부한다', () => {
    // 스펙 8.2: to-one 관계 URL은 모든 조회 파라미터를 거부한다.
    const error = caught(() => {
      assertNoQueryParameters({ include: 'category' });
    });
    expect(error.code).toBe('INVALID_QUERY_PARAMETER');
    expect(error.source).toEqual({ parameter: 'include' });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/query.spec.ts`
Expected: FAIL — `Cannot find module '../../src/app/jsonapi/query.js'`

- [ ] **Step 3: 구현한다**

`src/app/jsonapi/query.ts`:

```ts
import type { QueryPolicy } from '../schemas/query-policy.js';
import { JsonApiError } from './errors.js';
import { isFilterKey, parseFilters } from './filter.js';
import type { FilterCondition } from './filter.js';
import { parseInclude } from './include.js';
import { isPageKey, parsePage } from './pagination.js';
import type { PageRequest } from './pagination.js';
import { parseSort } from './sort.js';
import type { ResolvedSort } from './sort.js';

/**
 * 조회 질의 전체 검증과 조립.
 *
 * 알 수 없는 파라미터를 **먼저** 거부한다. 오타 난 파라미터가 조용히 무시되는 것이 이
 * 계층에서 가장 흔한 사고이고, 그 사실을 먼저 말해 주는 편이 값 오류보다 진단에 낫다.
 */

/** 해석을 마친 조회 질의. */
export interface ParsedQuery {
  readonly filters: readonly FilterCondition[];
  readonly sort: readonly ResolvedSort[];
  readonly include: readonly string[];
  readonly page: PageRequest;
}

function invalidParameter(parameter: string, detail: string): JsonApiError {
  return new JsonApiError('INVALID_QUERY_PARAMETER', { source: { parameter }, detail });
}

function assertKnownKeys(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): void {
  for (const key of Object.keys(query)) {
    if (key === 'sort' || key === 'include' || isFilterKey(key) || isPageKey(key)) {
      continue;
    }
    if (key.startsWith('fields[')) {
      // 희소 필드셋은 스펙 1.1의 비목표다. 조용히 무시하면 클라이언트는 적용됐다고 읽는다.
      throw invalidParameter(key, 'sparse fieldsets are not supported');
    }
    throw invalidParameter(key, 'the query parameter is not supported');
  }
}

/** 컬렉션 조회 질의를 해석한다. */
export function parseQuery(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
  declaredRelationships: readonly string[],
): ParsedQuery {
  assertKnownKeys(query);

  return {
    filters: parseFilters(query, policy),
    sort: parseSort(query, policy),
    include: parseInclude(query, policy, declaredRelationships),
    page: parsePage(query, policy),
  };
}

/**
 * to-many 관계 URL(`GET /{id}/{rel}`)의 질의를 해석한다.
 *
 * 스펙 8.2: `page[number]`/`page[size]`만 지원하고 `filter`·`sort`·`include`는 받지
 * 않는다. 총 개수는 언제나 낸다 — 관계 컬렉션은 대체로 작고, 클라이언트가 개수를 알아야
 * 관계 편집 화면을 그릴 수 있다.
 */
export function parseRelatedCollectionQuery(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  policy: QueryPolicy,
): PageRequest {
  for (const key of Object.keys(query)) {
    if (key === 'page[number]' || key === 'page[size]') {
      continue;
    }
    throw invalidParameter(key, 'a related collection only supports page[number] and page[size]');
  }

  const page = parsePage(query, policy);
  return { ...page, totals: true };
}

/**
 * to-one 관계 URL(`GET /{id}/{rel}`)에는 조회 파라미터를 허용하지 않는다.
 *
 * 스펙 8.2. 자원 하나를 가리키는 경로에서 filter나 page는 뜻이 없고, 받아 주면
 * 클라이언트가 뜻이 있다고 오해한다.
 */
export function assertNoQueryParameters(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
): void {
  for (const key of Object.keys(query)) {
    throw invalidParameter(key, 'this endpoint does not accept query parameters');
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/jsonapi/query.spec.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/jsonapi/query.ts test/jsonapi/query.spec.ts
git commit -m "feat(jsonapi): 질의 파라미터 전체 검증과 조립 추가"
```

---

### Task 11: SelectQueryBuilder 컴파일과 실제 PostgreSQL 검증

**Files:**
- Create: `src/app/jsonapi/query-compiler.ts`
- Test: `test/integration/query-compiler.spec.ts`

**Interfaces:**
- Consumes: `ParsedQuery` (Task 10); `FilterCondition` (Task 5); `ResolvedSort`, `sortSignature` (Task 6); `probeLimit`, `sliceProbe`, `PageRequest` (Task 8); `assertCursorSortable`, `decodeCursor`, `encodeCursor`, `keysetPredicate` (Task 9); `ResourceSerializer` (Task 1)
- Produces:
  - `interface ListResult<T> { items: readonly T[]; hasMore: boolean; totalCount?: number; firstCursor?: string; lastCursor?: string }`
  - `function applyFilters<T extends ObjectLiteral>(builder: SelectQueryBuilder<T>, alias: string, conditions: readonly FilterCondition[]): void`
  - `function applySort<T extends ObjectLiteral>(builder: SelectQueryBuilder<T>, alias: string, sort: readonly ResolvedSort[], reversed: boolean): void`
  - `function executeList<T extends ObjectLiteral & { id: string }>(builder, alias, parsed, serializer): Promise<ListResult<T>>`

**설계:** 파싱·검증은 이미 끝났다. 이 파일은 검증된 조건을 SQL로 옮기기만 한다. 컬럼 이름은 언제나 `FilterCondition.property`·`ResolvedSort.property`에서 나오고, 값은 언제나 바인딩 파라미터로 간다.

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다**

`test/integration/query-compiler.spec.ts`:

```ts
import type { DataSource, EntityManager } from 'typeorm';
import { executeList } from '../../src/app/jsonapi/query-compiler.js';
import { parseQuery } from '../../src/app/jsonapi/query.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

const DECLARED = Object.keys(EXAMPLE_SERIALIZER.relationships);

/** 결정적인 시각. 정렬과 커서 검증이 시각에 기대므로 고정한다. */
function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 30, 0, minutes, 0));
}

async function seedExamples(manager: EntityManager): Promise<{ category: Category; tag: Tag }> {
  const category = await manager.save(manager.create(Category, { name: '분류' }));
  const tag = await manager.save(manager.create(Tag, { name: '라벨' }));
  // createdAt은 @CreateDateColumn이라 저장 시각이 들어간다. 정렬을 결정적으로 만들려고
  // 저장 뒤에 직접 갱신한다.
  for (let index = 0; index < 5; index += 1) {
    const saved = await manager.save(
      manager.create(Example, {
        title: `제목 ${String(index)}`,
        status: index % 2 === 0 ? 'draft' : 'published',
        categoryId: index < 3 ? category.id : null,
        publishedAt: index % 2 === 0 ? null : at(index),
        tags: index === 0 ? [tag] : [],
      }),
    );
    await manager.update(Example, { id: saved.id }, { createdAt: at(index) });
  }
  return { category, tag };
}
// `@CreateDateColumn`을 `update()`로 덮어쓰는 것이 TypeORM 1.1에서 막혀 있다면
// `manager.query('UPDATE examples SET created_at = $1 WHERE id = $2', [...])`로 바꾼다.
// 정렬과 커서 검증이 결정적인 `created_at`에 기대므로, 저장 시각을 그대로 두면
// 같은 밀리초에 여러 행이 들어가 순서가 흔들린다.

function list(manager: EntityManager) {
  return manager.createQueryBuilder(Example, 'e');
}

describe('executeList — 필터', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('exact 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'filter[status]': 'draft' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(3);
      expect(result.items.every((item) => item.status === 'draft')).toBe(true);
    });
  });

  it('contains 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[title][contains]': '목 1' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(1);
    });
  });

  it('contains는 부분 일치를 리터럴로 다룬다', async () => {
    // `%`가 그대로 새면 사용자가 와일드카드를 주입할 수 있다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'filter[title][contains]': '%' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(0);
    });
  });

  it('in 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[status][in]': 'draft,published' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(5);
    });
  });

  it('isNull 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const truthy = parseQuery(
        { 'filter[category][isNull]': 'true' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect((await executeList(list(manager), 'e', truthy, EXAMPLE_SERIALIZER)).items).toHaveLength(
        2,
      );
      const falsy = parseQuery(
        { 'filter[category][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect((await executeList(list(manager), 'e', falsy, EXAMPLE_SERIALIZER)).items).toHaveLength(
        3,
      );
    });
  });

  it('gt/gte/lt/lte 필터로 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[createdAt][gte]': at(3).toISOString() },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect((await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).items).toHaveLength(
        2,
      );
    });
  });

  it('공개 이름 category가 FK 컬럼을 거른다', async () => {
    await withRollback(dataSource, async (manager) => {
      const { category } = await seedExamples(manager);
      const parsed = parseQuery({ 'filter[category]': category.id }, EXAMPLE_QUERY_POLICY, DECLARED);
      expect((await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).items).toHaveLength(
        3,
      );
    });
  });

  it('여러 필터를 AND로 묶는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'filter[status]': 'draft', 'filter[category][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect((await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).items).toHaveLength(
        2,
      );
    });
  });
});

describe('executeList — 정렬과 include', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('기본 정렬은 createdAt 내림차순이다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.map((item) => item.title)).toEqual([
        '제목 4',
        '제목 3',
        '제목 2',
        '제목 1',
        '제목 0',
      ]);
    });
  });

  it('sort로 정렬을 바꾼다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ sort: 'title' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.map((item) => item.title)).toEqual([
        '제목 0',
        '제목 1',
        '제목 2',
        '제목 3',
        '제목 4',
      ]);
    });
  });

  it('include가 to-one 관계를 함께 읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { include: 'category', 'filter[category][isNull]': 'false' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.every((item) => item.category instanceof Category)).toBe(true);
    });
  });

  it('include가 to-many 관계를 함께 읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ include: 'tags', sort: 'title' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items[0]?.tags).toHaveLength(1);
      expect(result.items[1]?.tags).toHaveLength(0);
    });
  });

  it('include하지 않은 관계는 읽지 않는다', async () => {
    // 로드되지 않은 관계는 undefined여야 시리얼라이저가 linkage를 생략한다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items[0]?.category).toBeUndefined();
      expect(result.items[0]?.tags).toBeUndefined();
    });
  });

  it('to-many를 include해도 페이지 크기가 흔들리지 않는다', async () => {
    // 조인이 행을 늘리면 한 페이지가 조용히 줄어든다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { include: 'tags', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });
});

describe('executeList — offset 페이지네이션', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('요청 크기만큼 자르고 다음 페이지 존재를 알려 준다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'page[size]': '2' }, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });

  it('마지막 페이지에서는 hasMore가 거짓이다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[size]': '2', 'page[number]': '3' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });
  });

  it('totals를 요청하지 않으면 총 개수를 세지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({}, EXAMPLE_QUERY_POLICY, DECLARED);
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.totalCount).toBeUndefined();
    });
  });

  it('totals를 요청하면 필터를 반영한 총 개수를 낸다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[totals]': 'true', 'page[size]': '2', 'filter[status]': 'draft' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.totalCount).toBe(3);
      expect(result.items).toHaveLength(2);
    });
  });

  it('to-many를 include해도 총 개수가 부풀지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[totals]': 'true', include: 'tags' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      expect((await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).totalCount).toBe(5);
    });
  });
});

describe('executeList — cursor 페이지네이션', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('빈 after는 컬렉션 처음부터 읽는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      expect(result.items.map((item) => item.title)).toEqual(['제목 4', '제목 3']);
      expect(result.hasMore).toBe(true);
    });
  });

  it('커서를 따라가면 겹치거나 건너뛰지 않는다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const seen: string[] = [];
      let cursor = '';
      for (let round = 0; round < 3; round += 1) {
        const parsed = parseQuery(
          { 'page[after]': cursor, 'page[size]': '2' },
          EXAMPLE_QUERY_POLICY,
          DECLARED,
        );
        const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
        seen.push(...result.items.map((item) => item.title));
        if (result.lastCursor === undefined) {
          break;
        }
        cursor = result.lastCursor;
      }
      expect(seen).toEqual(['제목 4', '제목 3', '제목 2', '제목 1', '제목 0']);
    });
  });

  it('before는 뒤에서부터 읽고 순서를 유지한다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[before]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const result = await executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER);
      // 정렬은 createdAt DESC이므로 끝은 가장 오래된 둘이고, 순서는 정렬 그대로다.
      expect(result.items.map((item) => item.title)).toEqual(['제목 1', '제목 0']);
    });
  });

  it('앞쪽에 행이 끼어들어도 커서가 같은 지점을 가리킨다', async () => {
    // OFFSET과 갈라지는 지점이다. OFFSET이었다면 한 행을 두 번 보게 된다.
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const first = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page1 = await executeList(list(manager), 'e', first, EXAMPLE_SERIALIZER);

      const inserted = await manager.save(manager.create(Example, { title: '끼어든 것' }));
      await manager.update(Example, { id: inserted.id }, { createdAt: at(99) });

      const cursor = page1.lastCursor;
      if (cursor === undefined) {
        throw new Error('커서가 없다');
      }
      const second = parseQuery(
        { 'page[after]': cursor, 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page2 = await executeList(list(manager), 'e', second, EXAMPLE_SERIALIZER);
      expect(page2.items.map((item) => item.title)).toEqual(['제목 2', '제목 1']);
    });
  });

  it('nullable 정렬과 커서를 함께 쓰면 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery(
        { 'page[after]': '', sort: 'publishedAt' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      await expect(executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).rejects.toThrow(
        /nullable sort/,
      );
    });
  });

  it('정렬을 바꾼 뒤 예전 커서를 쓰면 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const first = parseQuery(
        { 'page[after]': '', 'page[size]': '2' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      const page1 = await executeList(list(manager), 'e', first, EXAMPLE_SERIALIZER);
      const cursor = page1.lastCursor;
      if (cursor === undefined) {
        throw new Error('커서가 없다');
      }
      const changed = parseQuery(
        { 'page[after]': cursor, sort: 'title' },
        EXAMPLE_QUERY_POLICY,
        DECLARED,
      );
      await expect(executeList(list(manager), 'e', changed, EXAMPLE_SERIALIZER)).rejects.toThrow(
        /different sort order/,
      );
    });
  });

  it('손상된 커서는 INVALID_PAGE다', async () => {
    await withRollback(dataSource, async (manager) => {
      await seedExamples(manager);
      const parsed = parseQuery({ 'page[after]': '!!!' }, EXAMPLE_QUERY_POLICY, DECLARED);
      await expect(executeList(list(manager), 'e', parsed, EXAMPLE_SERIALIZER)).rejects.toThrow(
        /malformed/,
      );
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `TEST_DATABASE_URL=... node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false test/integration/query-compiler.spec.ts`
(테스트 DB가 없으면 `./scripts/check.sh`가 띄운다.)
Expected: FAIL — `Cannot find module '../../src/app/jsonapi/query-compiler.js'`

- [ ] **Step 3: 구현한다**

`src/app/jsonapi/query-compiler.ts`:

```ts
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { ResourceSerializer } from '../serializers/serializer.js';
import { assertCursorSortable, decodeCursor, encodeCursor, keysetPredicate } from './cursor.js';
import type { FilterCondition } from './filter.js';
import { probeLimit, sliceProbe } from './pagination.js';
import type { PageRequest } from './pagination.js';
import type { ParsedQuery } from './query.js';
import { sortSignature } from './sort.js';
import type { ResolvedSort } from './sort.js';

/**
 * 검증을 마친 질의를 `SelectQueryBuilder`로 옮긴다.
 *
 * 이 파일은 판단하지 않는다. 허용 여부는 파서들이 이미 끝냈고, 여기서는 컬럼 이름과
 * 바인딩 파라미터를 조립하기만 한다. 컬럼 이름은 언제나 `property`(정책 allowlist에서
 * 온 값)이고 값은 언제나 파라미터다 — 사용자 문자열이 SQL 문법 자리에 들어가는 경로가
 * 없다.
 */

/** 목록 조회 결과. */
export interface ListResult<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
  /** `page[totals]=true`를 보낸 요청에만 있다. */
  readonly totalCount?: number;
  /** 이번 페이지 첫 행의 커서. cursor 모드에서만 만든다. */
  readonly firstCursor?: string;
  /** 이번 페이지 마지막 행의 커서. cursor 모드에서만 만든다. */
  readonly lastCursor?: string;
}

/** 검증된 필터 조건을 WHERE로 옮긴다. */
export function applyFilters<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  alias: string,
  conditions: readonly FilterCondition[],
): void {
  conditions.forEach((condition, index) => {
    const parameter = `filter${String(index)}`;
    const column = `${alias}.${condition.property}`;

    switch (condition.operator) {
      case 'exact':
        builder.andWhere(`${column} = :${parameter}`, { [parameter]: condition.value });
        break;
      case 'contains':
        // `%`와 `_`를 이스케이프한다. 그대로 새면 사용자가 와일드카드를 주입한다.
        builder.andWhere(`${column} ILIKE :${parameter} ESCAPE '\\'`, {
          [parameter]: `%${escapeLike(String(condition.value))}%`,
        });
        break;
      case 'gt':
        builder.andWhere(`${column} > :${parameter}`, { [parameter]: condition.value });
        break;
      case 'gte':
        builder.andWhere(`${column} >= :${parameter}`, { [parameter]: condition.value });
        break;
      case 'lt':
        builder.andWhere(`${column} < :${parameter}`, { [parameter]: condition.value });
        break;
      case 'lte':
        builder.andWhere(`${column} <= :${parameter}`, { [parameter]: condition.value });
        break;
      case 'in':
        builder.andWhere(`${column} IN (:...${parameter})`, { [parameter]: condition.value });
        break;
      case 'isNull':
        builder.andWhere(condition.value === true ? `${column} IS NULL` : `${column} IS NOT NULL`);
        break;
    }
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** 정렬을 ORDER BY로 옮긴다. `reversed`는 `page[before]`가 뒤에서부터 읽을 때 쓴다. */
export function applySort<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  alias: string,
  sort: readonly ResolvedSort[],
  reversed: boolean,
): void {
  sort.forEach((term, index) => {
    const direction = reversed === (term.direction === 'ASC') ? 'DESC' : 'ASC';
    const column = `${alias}.${term.property}`;
    if (index === 0) {
      builder.orderBy(column, direction);
    } else {
      builder.addOrderBy(column, direction);
    }
  });
}

function applyIncludes<T extends ObjectLiteral & { id: string }>(
  builder: SelectQueryBuilder<T>,
  alias: string,
  serializer: ResourceSerializer<T>,
  include: readonly string[],
): void {
  for (const path of include) {
    const definition = serializer.relationships[path];
    if (definition === undefined) {
      throw new TypeError(`선언되지 않은 관계 경로다: ${path}`);
    }
    builder.leftJoinAndSelect(`${alias}.${definition.eagerLoad}`, definition.eagerLoad);
  }
}

/**
 * 엔티티에서 정렬 키 값을 읽어 커서 값으로 만든다.
 *
 * TypeORM의 컬럼 메타데이터를 거친다 — 프로퍼티 이름으로 직접 인덱싱하면 `any`가
 * 흘러나오고, 컬럼이 없는 이름을 조용히 통과시킨다.
 */
function cursorValues<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  sort: readonly ResolvedSort[],
  entity: T,
): string[] {
  const metadata = builder.expressionMap.mainAlias?.metadata;
  if (metadata === undefined) {
    throw new TypeError('질의에 엔티티 메타데이터가 없다');
  }
  return sort.map((term) => {
    const column = metadata.findColumnWithPropertyName(term.property);
    if (column === undefined) {
      throw new TypeError(`정렬 프로퍼티에 대응하는 컬럼이 없다: ${term.property}`);
    }
    const value: unknown = column.getEntityValue(entity);
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    throw new TypeError(`커서로 쓸 수 없는 정렬 값이다: ${term.property}`);
  });
}

async function countTotal<T extends ObjectLiteral>(builder: SelectQueryBuilder<T>): Promise<number> {
  // include 조인 전에 복제한 질의로 센다. to-many 조인은 행을 늘리므로 조인 뒤에 세면
  // 총 개수가 부푼다.
  return builder.clone().getCount();
}

/**
 * 검증된 질의를 실행한다.
 *
 * COUNT는 `page[totals]=true`를 보낸 요청에만 돌린다(스펙 8.2). 다음 페이지 존재는
 * 언제나 한 행 더 읽어 판정한다.
 */
export async function executeList<T extends ObjectLiteral & { id: string }>(
  builder: SelectQueryBuilder<T>,
  alias: string,
  parsed: ParsedQuery,
  serializer: ResourceSerializer<T>,
): Promise<ListResult<T>> {
  applyFilters(builder, alias, parsed.filters);

  const totalCount = parsed.page.totals ? await countTotal(builder) : undefined;

  applyIncludes(builder, alias, serializer, parsed.include);

  const page: PageRequest = parsed.page;
  const reversed = page.mode === 'cursor' && page.before !== undefined;
  applySort(builder, alias, parsed.sort, reversed);
  builder.take(probeLimit(page));

  if (page.mode === 'offset') {
    builder.skip(((page.number ?? 1) - 1) * page.size);
  } else {
    assertCursorSortable(parsed.sort);
    const raw = page.after ?? page.before ?? '';
    if (raw !== '') {
      const values = decodeCursor(raw, sortSignature(parsed.sort), parsed.sort.length);
      const predicate = keysetPredicate(
        alias,
        parsed.sort,
        values,
        page.after === undefined ? 'before' : 'after',
      );
      builder.andWhere(predicate.clause, predicate.parameters);
    }
  }

  const rows = await builder.getMany();
  const probed = sliceProbe(rows, page);
  // `before`는 뒤에서부터 읽었으므로 되돌려 정렬 순서를 복원한다.
  const items = reversed ? [...probed.items].reverse() : probed.items;

  const first = items[0];
  const last = items[items.length - 1];

  return {
    items,
    hasMore: probed.hasMore,
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(page.mode === 'cursor' && first !== undefined
      ? { firstCursor: encodeCursor(sortSignature(parsed.sort), cursorValues(builder, parsed.sort, first)) }
      : {}),
    ...(page.mode === 'cursor' && last !== undefined
      ? { lastCursor: encodeCursor(sortSignature(parsed.sort), cursorValues(builder, parsed.sort, last)) }
      : {}),
  };
}
```

- [ ] **Step 4: 실제 PostgreSQL로 확인한다**

Run: `./scripts/check.sh`
Expected: exit 0

`cursor` 테스트가 실패하면 먼저 두 가지를 의심한다.
1. `builder.take()`와 `leftJoinAndSelect`가 함께 있으면 TypeORM이 두 질의로 나눠 실행한다. `getMany()`가 아니라 `getRawMany()`를 쓰면 이 처리가 사라진다 — `getMany()`를 쓴다.
2. 커서 값은 문자열로 나간다. `timestamptz` 컬럼과 비교할 때 PostgreSQL이 파라미터 타입을 컬럼에서 추론한다. 추론이 안 되면 `:cursor0::timestamptz` 같은 캐스트가 필요하다는 뜻인데, 그때는 `ResolvedSort`에 값 타입을 실어 캐스트를 붙이는 쪽으로 고친다.

- [ ] **Step 5: 커밋한다**

```bash
git add src/app/jsonapi/query-compiler.ts test/integration/query-compiler.spec.ts
git commit -m "feat(jsonapi): 조회 질의의 SelectQueryBuilder 컴파일 추가"
```

---

## 마무리

- [ ] **전체 게이트를 돌린다**

Run: `./scripts/check.sh`
Expected: exit 0, 커버리지 게이트(80%) 통과

- [ ] **README의 구조 절을 갱신한다**

`README.md`의 `## 구조` 코드 펜스에 두 줄을 더한다(`test/docs/readme.spec.ts`가 이 경로들이 실제로 존재하는지 확인한다).

```text
src/app/schemas/        # 조회 정책 (filter·sort·include allowlist)
src/app/serializers/    # 공개 표현 (JSON:API type·attributes·relationships)
```

같은 파일의 Phase 설명 문장에서 `Phase 0-2`를 `Phase 0-3`으로 바꾸고, 아직 구현되지 않은 목록에서 "시리얼라이저와 조회 정책"을 뺀다.

- [ ] **커밋한다**

```bash
git add README.md
git commit -m "docs: Phase 3 구조와 진행 상태를 README에 반영"
```
