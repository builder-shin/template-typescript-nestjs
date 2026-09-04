# NestJS 계약 통일 설계

- 작성일: 2026-09-04
- 대상 저장소: `template-typescript-nestjs`
- 정본 구현: `template-python-fastapi`
- 관련 스펙: `template-typescript-nextjs/docs/superpowers/specs/2026-09-04-nextjs-jsonapi-template-design.md` (6장이 10장의 계약을 소유한다)

## 1. 목표

이 저장소의 공개 계약을 정본과 **같게** 만든다. 완료 조건은 하나다 — 같은 요청에 같은 문서가 나온다.

이 저장소는 정본의 계약을 NestJS로 옮긴 것인데, 이후 변경에서 Example 도메인이 갈라졌다. 이 작업은 그 드리프트를 되돌리고, 세 백엔드에 공통으로 추가되는 참조 자원 라우트를 반영한다.

### 1.1 경쟁하는 접근안이 없다

목표가 정본으로 완전히 결정되어 있다. 각 항목의 "어떻게"에는 선택지가 없고, 있는 것은 "무엇이 어긋났는가"뿐이다. 그래서 이 스펙은 접근안 비교 없이 드리프트 전수 목록과 그 처리로 구성된다.

### 1.2 비목표 (YAGNI)

- 드리프트와 무관한 리팩터링
- 이미 적용된 마이그레이션 수정 (새 마이그레이션으로만 전달한다)
- `fields[...]` 희소 필드셋
- 참조 자원(`categories` · `tags`)의 쓰기 라우트

## 2. 드리프트 전수 목록

### 2.1 자원 타입 이름 — 가장 심각하다

| 현재 | 목표 |
| --- | --- |
| `categories` | `exampleCategories` |
| `tags` | `exampleTags` |

정본과 Rails가 모두 `exampleCategories` · `exampleTags`를 쓴다. 이 저장소만 다르다.

**wire에 그대로 드러난다.** `data[].relationships.*.data.type`, `included[].type`, 그리고 관계 쓰기 요청이 보내는 linkage의 `type`. 공유 프론트엔드에는 하드 브레이크다.

고칠 자리는 둘이다 — 시리얼라이저(`CATEGORY_SERIALIZER.type` · `TAG_SERIALIZER.type`)가 내보내는 쪽, `EXAMPLE_RELATIONSHIPS`가 받아들이는 쪽. 한쪽만 고치면 읽기와 쓰기가 갈라진다.

나머지 타입(`examples` · `users` · `authTokens` · `authCredentials` · `refreshTokens`)은 이미 정본과 같다.

### 2.2 리소스 스키마

| # | 현재 | 목표 |
| --- | --- | --- |
| 1 | `body` (text, nullable) | `description` (text, nullable) |
| 2 | `publishedAt` (timestamptz, nullable) | `score` (integer NOT NULL, `CHECK score >= 0 AND score <= 100`) |
| 3 | status `draft` / `published` / `archived` | `draft` / `active` / `archived` |

`score`의 범위 제약은 정본과 Rails 모두 DB 레벨에 있다. 애플리케이션 검증만으로는 두 곳이 갈라진다.

### 2.3 쿼리 정책

| # | 현재 | 목표 |
| --- | --- | --- |
| 4 | filter 이름 `category` | `category.id` |
| 5 | filter `createdAt`에 `exact` 없음 | `exact` 추가 |
| 6 | filter `score` 없음 | `exact` · `gt` · `gte` · `lt` · `lte` · `in` |
| 7 | filter `publishedAt` | 제거 |
| 8 | sorts `createdAt` · `publishedAt` · `title` · `id` | `title` · `status` · `score` · `createdAt` · `updatedAt` |
| 9 | `id`가 공개 정렬이자 tie breaker | tie breaker **전용**. 정본의 공개 정렬에는 `id`가 없다 |

목표 상태:

```ts
filters: {
  title:         { property: 'title',       type: 'string',    operators: ['exact', 'contains'] },
  status:        { property: 'status',      type: 'enum',      operators: ['exact', 'in'], values: EXAMPLE_STATUSES },
  score:         { property: 'score',       type: 'integer',   operators: ['exact', 'gt', 'gte', 'lt', 'lte', 'in'] },
  'category.id': { property: 'categoryId',  type: 'uuid',      operators: ['exact', 'in', 'isNull'] },
  createdAt:     { property: 'createdAt',   type: 'timestamp', operators: ['exact', 'gt', 'gte', 'lt', 'lte'] },
},
sorts: {
  title:     { property: 'title',     nullable: false },
  status:    { property: 'status',    nullable: false },
  score:     { property: 'score',     nullable: false },
  createdAt: { property: 'createdAt', nullable: false },
  updatedAt: { property: 'updatedAt', nullable: false },
},
includes: ['category', 'tags'],
defaultSort: [{ field: 'createdAt', direction: 'DESC' }],
tieBreaker: { field: 'id', direction: 'ASC' },
defaultPageSize: 20,     // 현재 25 — 7장
```

### 2.4 쓰기 스키마

`ExampleCreate` · `ExampleUpdate` · `ExampleReplace` 셋 모두에서 `body` → `description`, `publishedAt` → `score`.

`score`는 NOT NULL 컬럼이므로 이 저장소의 규칙에 따라 `@ValidateIf(isPresent)`를 쓴다 — `@IsOptional()`은 `null`에도 모든 검증기를 건너뛰어 `{"score": null}`이 PostgreSQL까지 내려가 422여야 할 것이 500이 된다. `publishedAt`이 nullable이라 `@IsOptional()`이었던 자리이므로, 표기가 함께 바뀌어야 한다.

범위 검증(0~100)을 스키마에도 건다. DB 제약만 있으면 위반이 500으로 나간다.

## 3. 인덱스

정본은 기본 정렬 하나(`created_at DESC, id`)와 FK만 인덱싱한다. 이 저장소는 셋을 갖고 있어 오히려 과하다.

| 인덱스 | 처리 | 근거 |
| --- | --- | --- |
| `IDX_examples_published_at_id` | 제거 | 컬럼이 사라진다. 선택이 아니다 |
| `IDX_examples_created_at_id` | 유지 | 기본 정렬 |
| `IDX_examples_title_id` | 유지 | `title`은 여전히 정렬이고 기존 근거가 있다 |
| `status` · `score` · `updatedAt` (새로 여는 정렬) | **만들지 않는다** | `status`는 값 3종, `score`는 0~100 정수로 둘 다 선택도가 낮다. `updatedAt`은 정본도 인덱싱하지 않는다 — 목록의 주 부하 경로가 아니다 |

"정렬을 여는 변경은 인덱스를 진다"는 이 저장소의 규칙에 따라, 만들지 않기로 한 근거를 `example.query-policy.ts`의 선언부 주석에 남긴다.

## 4. 마이그레이션

이미 적용된 마이그레이션은 고치지 않는다. 새 마이그레이션 하나로 전달한다.

```text
컬럼   body → description                    RENAME
       published_at 제거, score 추가          (NOT NULL + CHECK 0..100)
enum   ALTER TYPE example_status
         RENAME VALUE 'published' TO 'active'
인덱스 IDX_examples_published_at_id 제거
```

엔티티와 마이그레이션의 제약·인덱스 이름이 글자까지 같아야 한다. 하나라도 이름을 생략하면 TypeORM이 해시 이름을 만들어 어긋나고, `test/integration/migrations.spec.ts`의 스키마 드리프트 검사가 잡는다. `score`의 CHECK 제약도 이름을 명시한다.

`score`가 NOT NULL이고 기존 행이 있으므로 기본값을 주고 추가한 뒤 제약을 건다.

## 5. 시드

`db/seeds.ts`가 `body` · `publishedAt` · `published`를 쓴다. 세 항목 모두 바꾼다. 시드는 결정적이어야 하므로 `score` 값도 고정한다.

## 6. 잃는 검증과 그 대체

`publishedAt`은 nullable이었고, "keyset cursor는 nullable 정렬을 거부한다"는 규칙을 실증하는 **유일한** 자원이었다. 제거하면 그 검증이 사라진다.

**정본이 이 문제를 이미 풀어 놓았다.** 공개 정책에 nullable 정렬을 두지 않고, 테스트에서 합성 정책을 만들어 검증한다 — `tests/jsonapi/test_query.py`의 `test_cursor_is_rejected_for_a_nullable_sort_column`이 `description`을 정렬로 여는 정책을 그 자리에서 만든다.

같은 방식을 쓴다. 공개 계약을 검증 편의로 오염시키지 않는다는 점에서 지금보다 낫다.

커서 코덱이 왕복시킬 수 없는 타입에 대한 거부도 같은 방식으로 단위 테스트에 둔다.

## 7. 기본 페이지 크기

| 저장소 | `defaultPageSize` | `MAX_PAGE_SIZE` |
| --- | --- | --- |
| 정본 (FastAPI) | **20** | 100 |
| Rails | 20 | 100 |
| 이 저장소 | **25** | 100 |

이 저장소만 25다. **wire에 그대로 드러난다** — `page[size]` 없이 목록을 부르면 25건과 20건으로 갈린다.

`example.query-policy.ts`의 `defaultPageSize`를 20으로 바꾼다. `MAX_PAGE_SIZE`는 세 저장소가 이미 100으로 같다.

## 8. 검증

기존 게이트(`./scripts/check.sh`)에 더한다.

| 대상 | 검증 |
| --- | --- |
| 자원 타입 | `included[].type`과 관계 linkage가 `exampleCategories` · `exampleTags`인 것. 읽기와 쓰기 양쪽 |
| 스키마 | `description` · `score` · `active` 응답. `score` 범위 위반이 422인 것 |
| 쿼리 정책 | 새 filter · sort 전부가 2xx. 제거된 `publishedAt` filter · sort가 `INVALID_FILTER` · `INVALID_SORT`인 것. `sort=id`가 거부되는 것 |
| 기본 페이지 크기 | `page[size]` 없는 목록이 20건인 것 |
| 마이그레이션 | 스키마 드리프트 검사 통과 (엔티티 ↔ 실제 스키마) |
| cursor | 합성 정책으로 nullable 정렬 거부 (6장) |
| 전체 | **정본과의 응답 대조** — 같은 요청에 같은 문서가 나오는가 |

마지막 항목이 진짜 완료 조건이다.

## 9. 단계

| 단계 | 내용 |
| --- | --- |
| 1 | 자원 타입 이름 (2.1) — 가장 작고 가장 파급이 크다. 먼저 한다 |
| 2 | 마이그레이션 + 엔티티 + 시리얼라이저 + 쓰기 스키마 (2.2 · 2.4 · 4 · 5) |
| 3 | 쿼리 정책 + 인덱스 + 기본 페이지 크기 (2.3 · 3 · 7) |
| 4 | cursor 검증 대체 (6장) |
| 5 | `categories` · `tags` 읽기 라우트 (10장) |

## 10. `categories` · `tags` 읽기 라우트

계약은 Next.js 스펙 6장이 소유한다. 여기서는 이 저장소의 반영만 정한다.

```text
GET /api/v1/categories · /api/v1/categories/{id}
GET /api/v1/tags       · /api/v1/tags/{id}
```

URL 경로는 `categories` · `tags`이고 JSON:API type은 `exampleCategories` · `exampleTags`다. 둘이 다른 것은 의도된 결정이다.

`@Controller` 경로와 시리얼라이저 `resourcePath`가 문자 단위로 같아야 한다는 이 저장소의 불변식은 양쪽 모두 `/api/v1/categories`이므로 성립한다. 두 시리얼라이저에 `resourcePath`를 새로 넣는다.

`CrudActions`에 쓰기 비활성 옵션을 추가한다 — `enableUpsert`가 같은 모양의 선례다. 읽기 라우트만 등록하고, 관계 라우트도 함께 빠진다.

조회 정책:

```text
filters:  name [exact, contains]
sorts:    name, createdAt
default:  name ASC          선택기는 알파벳순이 맞다
tie:      id ASC
includes: 없음              examples 역참조를 열면 순환이 생긴다
```

**새 인덱스를 만들지 않는다.** `name`이 UNIQUE라 `(name, id)` 정렬이 기존 인덱스로 커버된다. 근거를 정책 선언부 주석에 남긴다.

`resourcePath`가 생기면 두 자원에 `links.self`가 새로 붙는다. `GET /api/v1/examples?include=category,tags`의 `included[]` 응답이 바뀌므로, 같은 변경에서 스냅샷 기대값을 갱신한다.

## 11. 리스크

| 리스크 | 대응 |
| --- | --- |
| 타입 이름을 한쪽만 고친다 | 시리얼라이저(내보내기)와 `EXAMPLE_RELATIONSHIPS`(받기) 양쪽을 단계 1에서 함께 고치고, 관계 쓰기 spec으로 고정한다 |
| enum 값 변경이 기존 행을 깬다 | `ALTER TYPE ... RENAME VALUE`는 값을 바꾸지 않고 이름만 바꾼다. 기존 행이 그대로 따라온다 |
| `score` NOT NULL 추가가 기존 행에서 실패한다 | 기본값을 주고 추가한 뒤 제약을 건다 (4장) |
| 엔티티와 마이그레이션의 이름이 어긋난다 | 제약·인덱스 이름을 전부 명시한다. 드리프트 검사가 잡는다 |
| 정본과의 대조가 수작업이 된다 | Rails 스펙과 같은 대조 스크립트를 공유한다 |
