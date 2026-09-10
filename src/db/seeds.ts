import { pathToFileURL } from 'node:url';
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
  readonly description: string;
  readonly status: 'draft' | 'active' | 'archived';
  readonly score: number;
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
        description: example.description,
        status: example.status,
        score: example.score,
        categoryId: example.categoryId,
      })),
    )
    .orUpdate(['title', 'description', 'status', 'score', 'category_id'], ['id'])
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

const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/;

/**
 * `metaUrl`이 `argv1` 경로를 직접 실행한 결과인지 판정한다.
 *
 * 예전에는 `` `file://${argv1}` ``로 문자열을 직접 이어붙였다. Windows 경로
 * (`C:\Users\...`)의 드라이브 문자 뒤 콜론과 백슬래시는 그렇게 이어붙여도 유효한
 * `file://` URL이 되지 않아 이 비교가 Windows에서 항상 `false`였다 — `pnpm seed`가
 * 아무 일도 하지 않고 조용히 종료 코드 0으로 끝났다. POSIX에서도 경로에 공백이나
 * 비ASCII 문자(이 템플릿처럼 한글 경로)가 섞이면 `import.meta.url`은 그것을
 * percent-encode하지만 이어붙인 문자열은 하지 않아 같은 문제가 났다.
 *
 * `pathToFileURL`이 이 변환을 대신하게 한다. TypeORM CLI가 마이그레이션 진입점에서
 * 이미 같은 이유로 이 함수를 쓰고, `pnpm migrate`가 Windows에서 이미 동작하는 것도
 * 그 덕분이다. `argv1`에 드라이브 문자가 있는지로 Windows/POSIX 규칙을 직접 골라
 * `pathToFileURL`에 명시적으로 넘긴다 — 앰비언트 `process.platform`에 기대면 실제
 * 프로세스 안에서는 두 값이 같은 호스트에서 나오므로 문제없이 동작하지만, 이 판정을
 * 검증하는 테스트는 그 판정 로직이 실행되는 호스트(Windows 개발 머신, Linux CI)에
 * 따라 결과가 갈리게 된다. 입력 모양만으로 판단하면 이 함수도, 이 함수를 검증하는
 * 테스트도 실행 호스트와 무관해진다.
 */
export function isDirectRun(metaUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) {
    return false;
  }
  const windows = WINDOWS_DRIVE_PATTERN.test(argv1);
  return metaUrl === pathToFileURL(argv1, { windows }).href;
}

// `node dist/db/seeds.js`로 직접 실행할 때만 동작한다. import될 때는 아무 일도 하지 않는다.
if (isDirectRun(import.meta.url, process.argv[1])) {
  await main();
}
