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
    // 아래 "보낸 status는 그대로 남는다"와 짝이다 — 이 테스트는 "결측 → 되돌림" 분기를,
    // 그 테스트는 "보낸 값 사용" 분기를 본다. `status`는 컬럼 기본값(`draft`)이 있어
    // 두 분기의 결과가 서로 달라지므로 어느 분기가 실행됐는지 가릴 수 있다.
    await withRollback(dataSource, (manager) => {
      const values = replacementValues(manager, Example, { title: '제목' }, OWNED);
      expect(values.status).toBe('draft');
      return Promise.resolve();
    });
  });

  it('보낸 status는 그대로 남는다', async () => {
    // 위 "보내지 않은 필드에 컬럼 기본값이 있으면..." 테스트와 짝이다. `status`를 보내면
    // "보낸 값 사용" 분기(`property in attributes`)를 타고, 보내지 않으면 위 테스트가
    // 보는 "결측 → 되돌림" 분기(`resetValueFor`)를 탄다 — 결과가 갈리므로 둘 중 어느
    // 분기가 실행됐는지 이 쌍으로 가릴 수 있다.
    await withRollback(dataSource, (manager) => {
      const values = replacementValues(
        manager,
        Example,
        { title: '제목', status: 'published' },
        OWNED,
      );
      expect(values.status).toBe('published');
      return Promise.resolve();
    });
  });

  it('null로 보낸 nullable 필드도 null이다', async () => {
    // 주의: 이 테스트 하나만으로는 "보낸 값 사용"과 "결측 → 되돌림" 두 분기를 가릴 수
    // 없다 — `body`가 nullable이라 두 분기 모두 결과가 `null`로 같다. 분기를 가르는
    // 것은 위 `status` 쌍("보내지 않은 필드에 컬럼 기본값이 있으면..."/"보낸 status는
    // 그대로 남는다")이고, 이 테스트가 지키는 것은 별개의 계약이다 — 명시적 `null`이
    // "안 보냄"으로 오인되어 사라지지 않는다는 것.
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

  it('프로퍼티 이름과 DB 컬럼 이름이 다른 필드도 실제로 갱신한다', async () => {
    // `orUpdate`는 DB 컬럼 이름을 받고 `values`의 키는 프로퍼티 이름이다(파일 머리 주석
    // 참고). `publishedAt` 프로퍼티는 DB 컬럼명이 `published_at`으로 갈리므로,
    // `updatable`을 만들 때 `column.databaseName` 대신 프로퍼티 이름을 그대로 넘기는
    // 회귀가 생기면 `EXCLUDED.publishedAt`이 실제 컬럼과 이름이 달라 쿼리 자체가 죽는다
    // (실측: "column excluded.publishedAt does not exist"). title·body만 쓰는 다른
    // 테스트들은 프로퍼티 이름과 컬럼 이름이 우연히 같아서 이 회귀를 잡지 못한다.
    await withRollback(dataSource, async (manager) => {
      const first = new Date('2026-01-01T00:00:00.000Z');
      const second = new Date('2026-06-15T00:00:00.000Z');
      await upsertRow(manager, Example, ID, { title: '처음', publishedAt: first });
      await upsertRow(manager, Example, ID, { title: '두 번째', publishedAt: second });
      const rows = await manager.query<{ published_at: Date }[]>(
        `SELECT published_at FROM examples WHERE id = $1`,
        [ID],
      );
      expect(rows[0]?.published_at.toISOString()).toBe(second.toISOString());
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

  it('컬럼이 없는 프로퍼티를 넘기면 프로그래밍 오류다', async () => {
    // `upsertRow`의 `values`는 스키마와 무관한 자유 `Record`라 이 분기는 방어 코드가
    // 아니라 호출자 입력 검증이다 — `replacementValues`를 거치지 않고 오탈자 난
    // 프로퍼티 이름을 직접 넘기는 호출이 실제로 여기 도달한다.
    await withRollback(dataSource, async (manager) => {
      await expect(upsertRow(manager, Example, ID, { 없는프로퍼티: 1 })).rejects.toThrow(TypeError);
    });
  });
});
