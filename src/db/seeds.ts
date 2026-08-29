import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Category } from '../app/models/category.entity.js';
import { Example } from '../app/models/example.entity.js';
import { Tag } from '../app/models/tag.entity.js';
import { buildDataSourceOptions } from '../config/database.js';
import { loadDatabaseSettings } from '../config/settings.js';

/**
 * 결정적 시드.
 *
 * 고정 UUID와 PostgreSQL upsert를 쓴다. 몇 번을 돌려도 같은 결과가 나와야 배포 절차에서
 * 안전하게 재실행할 수 있다. 손으로 바꾼 행도 선언 값으로 되돌린다 — 시드는 "이 상태여야
 * 한다"는 선언이지 "없으면 만든다"는 보정이 아니다.
 *
 * `seed()`는 트랜잭션을 스스로 열지 않고 `EntityManager`를 받는다. 테스트는 롤백되는
 * 트랜잭션 안에서 부르고 CLI는 자기 트랜잭션을 연다. 시드가 트랜잭션을 소유하면 테스트가
 * 결과를 롤백할 수 없다.
 */

/**
 * 각 그룹의 고정 UUID.
 *
 * `as const`로 리터럴 키를 유지한 뒤 `SEED_*_IDS`로 넓혀 내보낸다. `noUncheckedIndexedAccess`
 * 아래에서 `Readonly<Record<string, string>>` 타입 값을 `.guides`처럼 점 접근하면 인덱스
 * 시그니처를 거치므로 `string | undefined`가 된다 — 이 파일 안에서 `CATEGORIES` 등을 만들 때
 * 그 `undefined`를 `!`나 `as`로 지우고 싶지 않아, 리터럴 키를 가진 이 내부 객체를 따로 두고
 * 그 값으로 아래 배열을 채운다. 내보내는 상수는 인터페이스가 요구하는 타입 그대로다.
 */
const CATEGORY_ID_LITERALS = {
  guides: '0195c1a0-0000-7000-8000-000000000001',
  references: '0195c1a0-0000-7000-8000-000000000002',
} as const;

const TAG_ID_LITERALS = {
  jsonapi: '0195c1a0-0000-7000-8000-000000000011',
  nestjs: '0195c1a0-0000-7000-8000-000000000012',
  postgres: '0195c1a0-0000-7000-8000-000000000013',
} as const;

const EXAMPLE_ID_LITERALS = {
  gettingStarted: '0195c1a0-0000-7000-8000-000000000021',
  queryPolicy: '0195c1a0-0000-7000-8000-000000000022',
} as const;

/** 시드 분류의 고정 식별자. */
export const SEED_CATEGORY_IDS: Readonly<Record<string, string>> = CATEGORY_ID_LITERALS;

/** 시드 라벨의 고정 식별자. */
export const SEED_TAG_IDS: Readonly<Record<string, string>> = TAG_ID_LITERALS;

/** 시드 Example의 고정 식별자. */
export const SEED_EXAMPLE_IDS: Readonly<Record<string, string>> = EXAMPLE_ID_LITERALS;

interface CategorySeed {
  readonly id: string;
  readonly name: string;
}

interface TagSeed {
  readonly id: string;
  readonly name: string;
}

interface ExampleSeed {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: 'draft' | 'published' | 'archived';
  readonly categoryId: string;
  readonly tagIds: readonly string[];
}

const CATEGORIES: readonly CategorySeed[] = [
  { id: CATEGORY_ID_LITERALS.guides, name: '안내서' },
  { id: CATEGORY_ID_LITERALS.references, name: '참고 자료' },
];

const TAGS: readonly TagSeed[] = [
  { id: TAG_ID_LITERALS.jsonapi, name: 'json-api' },
  { id: TAG_ID_LITERALS.nestjs, name: 'nestjs' },
  { id: TAG_ID_LITERALS.postgres, name: 'postgres' },
];

const EXAMPLES: readonly ExampleSeed[] = [
  {
    id: EXAMPLE_ID_LITERALS.gettingStarted,
    title: '시작하기',
    body: '이 템플릿으로 JSON:API 자원을 추가하는 방법을 설명한다.',
    status: 'published',
    categoryId: CATEGORY_ID_LITERALS.guides,
    tagIds: [TAG_ID_LITERALS.jsonapi, TAG_ID_LITERALS.nestjs],
  },
  {
    id: EXAMPLE_ID_LITERALS.queryPolicy,
    title: '조회 정책',
    body: 'filter·sort·include 허용 목록을 선언하는 방법을 설명한다.',
    status: 'draft',
    categoryId: CATEGORY_ID_LITERALS.references,
    tagIds: [TAG_ID_LITERALS.postgres],
  },
];

/**
 * 시드를 적용한다.
 *
 * 호출자가 트랜잭션을 소유한다. 이 함수는 commit도 rollback도 하지 않는다.
 */
export async function seed(manager: EntityManager): Promise<void> {
  await manager
    .createQueryBuilder()
    .insert()
    .into(Category)
    .values([...CATEGORIES])
    .orUpdate(['name'], ['id'])
    .execute();

  await manager
    .createQueryBuilder()
    .insert()
    .into(Tag)
    .values([...TAGS])
    .orUpdate(['name'], ['id'])
    .execute();

  await manager
    .createQueryBuilder()
    .insert()
    .into(Example)
    .values(
      EXAMPLES.map((example) => ({
        id: example.id,
        title: example.title,
        body: example.body,
        status: example.status,
        categoryId: example.categoryId,
      })),
    )
    .orUpdate(['title', 'body', 'status', 'category_id'], ['id'])
    .execute();

  // 조인 행은 선언 상태로 맞춘다. 먼저 지우고 다시 넣어야 시드에서 뺀 관계도 사라진다.
  for (const example of EXAMPLES) {
    await manager.query(`DELETE FROM example_tags WHERE example_id = $1`, [example.id]);
    for (const tagId of example.tagIds) {
      await manager.query(
        `INSERT INTO example_tags (example_id, tag_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [example.id, tagId],
      );
    }
  }
}

/**
 * `node dist/db/seeds.js` 진입점.
 *
 * 여기서 트랜잭션을 연다. 시드 전체가 한 트랜잭션이므로 도중에 실패하면 아무것도 남지 않는다.
 */
export async function main(): Promise<void> {
  const dataSource = new DataSource(buildDataSourceOptions(loadDatabaseSettings()));
  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      await seed(manager);
    });
  } finally {
    await dataSource.destroy();
  }
}

// `node dist/db/seeds.js`로 직접 실행할 때만 동작한다. import될 때는 아무 일도 하지 않는다.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
