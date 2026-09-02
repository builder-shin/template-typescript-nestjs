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

  // `replacementValues`는 동기 함수라 아래 콜백들은 `await`를 쓸 일이 없다. `withRollback`의
  // `fn`은 `Promise`를 돌려줘야 하므로, `async`로 감싸는 대신(그러면 `require-await`에 걸린다)
  // 끝에서 `Promise.resolve()`를 직접 돌려준다.

  it('보낸 필드는 그대로 싣는다', async () => {
    await withRollback(dataSource, (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect(values.title).toBe('제목');
      return Promise.resolve();
    });
  });

  it('보내지 않은 nullable 필드를 null로 되돌린다', async () => {
    // PUT은 전체 교체다. 보내지 않은 필드가 예전 값을 유지하면 PATCH와 구분이 없어진다.
    await withRollback(dataSource, (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect(values.body).toBeNull();
      expect(values.publishedAt).toBeNull();
      return Promise.resolve();
    });
  });

  it('보내지 않은 필드에 컬럼 기본값이 있으면 그 값으로 되돌린다', async () => {
    await withRollback(dataSource, (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect(values.status).toBe('draft');
      return Promise.resolve();
    });
  });

  it('null로 보낸 nullable 필드도 null이다', async () => {
    await withRollback(dataSource, (manager) => {
      const values = replacementValues(manager, Example, { title: '제목', body: null }, OWNED);
      expect(values.body).toBeNull();
      return Promise.resolve();
    });
  });

  it('스키마에 없는 프로퍼티는 싣지 않는다', async () => {
    await withRollback(dataSource, (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect('categoryId' in values).toBe(false);
      expect('createdAt' in values).toBe(false);
      return Promise.resolve();
    });
  });

  it('컬럼이 없는 프로퍼티를 요구하면 프로그래밍 오류다', async () => {
    await withRollback(dataSource, (manager) => {
      expect(() => replacementValues(manager, Example, {}, ['없는필드'])).toThrow(TypeError);
      return Promise.resolve();
    });
  });

  it('되돌릴 값이 없는 필드를 요구하면 프로그래밍 오류다', async () => {
    // `title`은 NOT NULL이고 기본값도 없다. 교체 스키마가 이 필드를 선택으로 두면
    // 되돌릴 값이 없으므로, 그 선언 실수를 여기서 시끄럽게 잡는다.
    await withRollback(dataSource, (manager) => {
      expect(() => replacementValues(manager, Example, {}, ['title'])).toThrow(/title/);
      return Promise.resolve();
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
