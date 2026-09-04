import { plainToInstance } from 'class-transformer';
import type { DataSource } from 'typeorm';
import {
  replacementValues,
  upsertRow,
} from '../../src/app/controllers/concerns/upsert-executor.js';
import { Category } from '../../src/app/models/category.entity.js';
import { Example } from '../../src/app/models/example.entity.js';
import { ExampleReplace } from '../../src/app/schemas/example.schemas.js';
import { schemaProperties } from '../../src/app/schemas/write-schema.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

const ID = '0195c1a0-0000-7000-8000-00000000e001';
const OWNED = schemaProperties(ExampleReplace);

/**
 * 실제 요청 경로가 `replacementValues`에 넘기는 것과 같은 모양을 만든다.
 *
 * `document.ts`의 `parseResourceInput`이 하는 것과 정확히 같다 — 원본 평문 객체의
 * 키 집합을 `presentKeys`로, `plainToInstance`가 만든 인스턴스를 `attributes`로 쓴다.
 * 이 헬퍼가 지금 존재하는 이유가 회귀 하나다: 예전 테스트들은 `{ title: '제목' }` 같은
 * 평문 객체 리터럴을 그대로 `attributes`로 넘겼는데, 그러면 "보내지 않은 키가 없다"는
 * 성질이 우연히 성립해(리터럴은 안 쓴 키를 아예 안 갖는다) `property in attributes`의
 * 버그(운영 경로가 실제로 넘기는 `plainToInstance` 인스턴스에서는 스키마가 소유한
 * 프로퍼티 전부가 `undefined` 값으로 존재해 언제나 참이 되는 것)를 볼 수 없었다.
 */
function parse(raw: Record<string, unknown>): {
  attributes: ExampleReplace;
  presentKeys: ReadonlySet<string>;
} {
  return {
    attributes: plainToInstance(ExampleReplace, raw),
    presentKeys: new Set(Object.keys(raw)),
  };
}

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
      const { attributes, presentKeys } = parse({ title: '제목', score: 50 });
      const values = replacementValues(manager, Example, attributes, presentKeys, OWNED);
      expect(values.title).toBe('제목');
      return Promise.resolve();
    });
  });

  it('보내지 않은 nullable 필드를 null로 되돌린다', async () => {
    // PUT은 전체 교체다. 보내지 않은 필드가 예전 값을 유지하면 PATCH와 구분이 없어진다.
    // `score`는 함께 보낸다 — NOT NULL이고 컬럼 기본값이 없어, 보내지 않으면 이 분기
    // 자체가 아니라 `resetValueFor`의 예외 분기(아래 별도 테스트)를 타 버린다.
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({ title: '제목', score: 50 });
      const values = replacementValues(manager, Example, attributes, presentKeys, OWNED);
      expect(values.description).toBeNull();
      return Promise.resolve();
    });
  });

  it('보내지 않은 필드에 컬럼 기본값이 있으면 그 값으로 되돌린다', async () => {
    // 아래 "보낸 status는 그대로 남는다"와 짝이다 — 이 테스트는 "결측 → 되돌림" 분기를,
    // 그 테스트는 "보낸 값 사용" 분기를 본다. `status`는 컬럼 기본값(`draft`)이 있어
    // 두 분기의 결과가 서로 달라지므로 어느 분기가 실행됐는지 가릴 수 있다.
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({ title: '제목', score: 50 });
      const values = replacementValues(manager, Example, attributes, presentKeys, OWNED);
      expect(values.status).toBe('draft');
      return Promise.resolve();
    });
  });

  it('보낸 status는 그대로 남는다', async () => {
    // 위 "보내지 않은 필드에 컬럼 기본값이 있으면..." 테스트와 짝이다. `status`를 보내면
    // "보낸 값 사용" 분기(`presentKeys.has`)를 타고, 보내지 않으면 위 테스트가 보는
    // "결측 → 되돌림" 분기(`resetValueFor`)를 탄다 — 결과가 갈리므로 둘 중 어느 분기가
    // 실행됐는지 이 쌍으로 가릴 수 있다.
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({ title: '제목', status: 'active', score: 50 });
      const values = replacementValues(manager, Example, attributes, presentKeys, OWNED);
      expect(values.status).toBe('active');
      return Promise.resolve();
    });
  });

  it('null로 보낸 nullable 필드도 null이다', async () => {
    // 주의: 이 테스트 하나만으로는 "보낸 값 사용"과 "결측 → 되돌림" 두 분기를 가릴 수
    // 없다 — `description`이 nullable이라 두 분기 모두 결과가 `null`로 같다. 분기를 가르는
    // 것은 위 `status` 쌍("보내지 않은 필드에 컬럼 기본값이 있으면..."/"보낸 status는
    // 그대로 남는다")이고, 이 테스트가 지키는 것은 별개의 계약이다 — 명시적 `null`이
    // "안 보냄"으로 오인되어 사라지지 않는다는 것.
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({ title: '제목', description: null, score: 50 });
      const values = replacementValues(manager, Example, attributes, presentKeys, OWNED);
      expect(values.description).toBeNull();
      return Promise.resolve();
    });
  });

  it('스키마에 없는 프로퍼티는 싣지 않는다', async () => {
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({ title: '제목', score: 50 });
      const values = replacementValues(manager, Example, attributes, presentKeys, OWNED);
      expect('categoryId' in values).toBe(false);
      expect('createdAt' in values).toBe(false);
      return Promise.resolve();
    });
  });

  it('컬럼이 없는 프로퍼티를 요구하면 프로그래밍 오류다', async () => {
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({});
      expect(() =>
        replacementValues(manager, Example, attributes, presentKeys, ['없는필드']),
      ).toThrow(TypeError);
      return Promise.resolve();
    });
  });

  it('되돌릴 값이 없는 필드를 요구하면 프로그래밍 오류다', async () => {
    // `title`은 NOT NULL이고 기본값도 없다. 교체 스키마가 이 필드를 선택으로 두면
    // 되돌릴 값이 없으므로, 그 선언 실수를 여기서 시끄럽게 잡는다.
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({});
      expect(() => replacementValues(manager, Example, attributes, presentKeys, ['title'])).toThrow(
        /title/,
      );
      return Promise.resolve();
    });
  });

  it('실제 요청 모양(plainToInstance 인스턴스 + 전체 OWNED 목록)에서도 되돌림 사다리에 닿는다', async () => {
    // 이 테스트가 고정하는 회귀: `useDefineForClassFields`(이 tsconfig의 ES2023 타깃
    // 기본값) 아래서는 `plainToInstance(ExampleReplace, {})`가 만든 인스턴스도 title/
    // body/status/publishedAt 네 프로퍼티를 전부 own 프로퍼티로 갖는다(값은
    // `undefined`). `property in attributes`로 판정했다면 이 넷 모두 "보냈다"로 잘못
    // 읽혀 title조차 `resetValueFor`를 타지 않고 `undefined`가 그대로 실렸을 것이다.
    // 위의 "되돌릴 값이 없는 필드를 요구하면 프로그래밍 오류다"는 `ownedProperties`를
    // `['title']` 하나로 좁혀 그 분기만 격리해 보므로 이 회귀를 못 잡는다 — 여기서는
    // `replace()`가 실제로 쓰는 호출 모양(OWNED 전체) 그대로 title 하나만 비운다.
    await withRollback(dataSource, (manager) => {
      const { attributes, presentKeys } = parse({}); // title을 포함해 아무 것도 안 보냄
      expect(() => replacementValues(manager, Example, attributes, presentKeys, OWNED)).toThrow(
        /title/,
      );
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
      const outcome = await upsertRow(manager, Example, ID, { title: '처음', score: 50 });
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
      await upsertRow(manager, Example, ID, { title: '처음', score: 50 });
      const outcome = await upsertRow(manager, Example, ID, { title: '두 번째', score: 50 });
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
      await upsertRow(manager, Example, ID, { title: '처음', score: 50 });
      await upsertRow(manager, Example, ID, { title: '두 번째', score: 50 });
      const rows = await manager.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM examples WHERE id = $1`,
        [ID],
      );
      expect(rows).toEqual([{ count: 1 }]);
    });
  });

  it('보낸 컬럼만 갱신한다', async () => {
    await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음', score: 50, description: '본문' });
      await upsertRow(manager, Example, ID, { title: '두 번째', score: 50 });
      const rows = await manager.query<{ description: string | null }[]>(
        `SELECT description FROM examples WHERE id = $1`,
        [ID],
      );
      // 두 번째 호출이 `description`을 싣지 않았으므로 예전 값이 남는다. 전체 교체
      // 의미는 호출자가 `replacementValues`로 되돌릴 값을 채워 넣는 것으로 만든다.
      expect(rows).toEqual([{ description: '본문' }]);
    });
  });

  it('프로퍼티 이름과 DB 컬럼 이름이 다른 필드도 실제로 갱신한다', async () => {
    // `orUpdate`는 DB 컬럼 이름을 받고 `values`의 키는 프로퍼티 이름이다(파일 머리 주석
    // 참고). `categoryId` 프로퍼티는 DB 컬럼명이 `category_id`로 갈리므로,
    // `updatable`을 만들 때 `column.databaseName` 대신 프로퍼티 이름을 그대로 넘기는
    // 회귀가 생기면 `EXCLUDED.categoryId`가 실제 컬럼과 이름이 달라 쿼리 자체가 죽는다
    // (실측: "column excluded.categoryId does not exist"). title·score만 쓰는 다른
    // 테스트들은 프로퍼티 이름과 컬럼 이름이 우연히 같아서 이 회귀를 잡지 못한다.
    await withRollback(dataSource, async (manager) => {
      const first = await manager.save(manager.create(Category, { name: '분류 A' }));
      const second = await manager.save(manager.create(Category, { name: '분류 B' }));
      await upsertRow(manager, Example, ID, { title: '처음', score: 50, categoryId: first.id });
      await upsertRow(manager, Example, ID, {
        title: '두 번째',
        score: 50,
        categoryId: second.id,
      });
      const rows = await manager.query<{ category_id: string }[]>(
        `SELECT category_id FROM examples WHERE id = $1`,
        [ID],
      );
      expect(rows[0]?.category_id).toBe(second.id);
    });
  });

  it('트랜잭션 안에서 advisory 잠금을 잡는다', async () => {
    // `pg_locks`는 클러스터 전체를 담는 뷰다. `pid`로 이 커넥션 것만 거르지 않으면,
    // 이 스위트와 병렬로 도는 다른 워커(예: examples-api.spec.ts/examples-put.spec.ts는
    // `acquireCommitLock`으로 advisory 잠금을 스위트 수명 내내 붙든다)가 advisory
    // 잠금을 들고 있을 때 이 단언이 그 워커의 잠금을 세어 실제 계약과 무관하게
    // 흔들린다. `pg_backend_pid()`는 이 쿼리를 실행하는 바로 그 세션의 pid라 같은
    // `manager`(=같은 커넥션) 위에서 부르면 안전하게 좁혀진다.
    await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음', score: 50 });
      const locks = await manager.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`,
      );
      // 좁힌 뒤에는 "0보다 많다"가 아니라 정확한 개수를 안다 — 이 트랜잭션이 잡은
      // `id` 하나에 대한 advisory 잠금 하나뿐이다.
      expect(locks[0]?.count).toBe(1);
    });
  });

  it('트랜잭션이 끝나면 잠금이 풀린다', async () => {
    // `pg_advisory_xact_lock`은 트랜잭션 스코프다. 풀어 주는 코드를 잊을 자리가 없다는
    // 것이 세션 스코프 잠금 대신 이것을 고른 이유다.
    //
    // 위 테스트와 같은 이유로 pid를 좁혀야 한다 — 트랜잭션이 끝난 뒤에는 커넥션이
    // 풀로 돌아가므로 `dataSource.query`가 다른 커넥션을 받을 수 있고, 좁히지 않은
    // COUNT는 다른 워커가 그 순간 붙들고 있는 advisory 잠금까지 센다.
    const pid = await withRollback(dataSource, async (manager) => {
      await upsertRow(manager, Example, ID, { title: '처음', score: 50 });
      const rows = await manager.query<{ pid: number }[]>('SELECT pg_backend_pid() AS pid');
      const backendPid = rows[0]?.pid;
      if (backendPid === undefined) {
        throw new Error('pg_backend_pid를 읽지 못했다');
      }
      return backendPid;
    });
    const locks = await dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = $1`,
      [pid],
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
