import { pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Category } from '../app/models/category.entity.js';
import { Example } from '../app/models/example.entity.js';
import { Tag } from '../app/models/tag.entity.js';
import { buildDataSourceOptions } from '../config/database.js';
import { loadDatabaseSettings } from '../config/settings.js';

/** Fixed seed graph shared by all backend templates. */
export const SEED_CATEGORY_IDS = { default: '00000000-0000-4000-8000-000000000001' } as const;
export const SEED_TAG_IDS = { default: '00000000-0000-4000-8000-000000000002' } as const;
export const SEED_EXAMPLE_IDS = { default: '00000000-0000-4000-8000-000000000003' } as const;

const CATEGORIES = [{ id: SEED_CATEGORY_IDS.default, name: '기본 카테고리' }];
const TAGS = [{ id: SEED_TAG_IDS.default, name: '기본 태그' }];
const EXAMPLES = [
  {
    id: SEED_EXAMPLE_IDS.default,
    title: 'JSON:API 예시',
    description: 'JSON:API와 CRUD 동작을 확인하기 위한 기본 데이터입니다.',
    status: 'active' as const,
    score: 90,
    categoryId: SEED_CATEGORY_IDS.default,
    tagIds: [SEED_TAG_IDS.default],
  },
];

/** The caller owns the transaction; unchanged data keeps its timestamp. */
export async function seed(manager: EntityManager): Promise<void> {
  await manager
    .createQueryBuilder()
    .insert()
    .into(Category)
    .values([...CATEGORIES])
    .orUpdate(['name'], ['id'], { skipUpdateIfNoValuesChanged: true })
    .execute();

  await manager
    .createQueryBuilder()
    .insert()
    .into(Tag)
    .values([...TAGS])
    .orUpdate(['name'], ['id'], { skipUpdateIfNoValuesChanged: true })
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
    .orUpdate(['title', 'description', 'status', 'score', 'category_id'], ['id'], {
      skipUpdateIfNoValuesChanged: true,
    })
    .execute();

  // Preserve additional associations while restoring the declared seed relationship.
  for (const example of EXAMPLES) {
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
