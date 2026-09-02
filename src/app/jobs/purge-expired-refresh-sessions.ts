import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

/**
 * 클래스가 아니라 함수이므로 인스턴스 로거를 둘 자리가 없다. `process-example.ts`와
 * 같은 이유로 모듈 스코프 `Logger`를 그대로 쓴다 — `Logger.overrideLogger`는 호출마다
 * 정적 참조를 다시 읽으므로 이 상수 생성 시점과 무관하게 테스트가 가로챌 수 있다.
 */
const logger = new Logger('purgeExpiredRefreshSessions');

/** `purgeExpiredRefreshSessions`가 받는 설정. */
export interface PurgeOptions {
  /** 이 초만큼 더 지나 만료된 행만 지운다. 갓 만료된 행은 남겨 두는 유예 기간이다. */
  readonly retentionSeconds: number;
  /** 배치 하나가 지우는 최대 행 수. */
  readonly batchSize: number;
  /** 배치 하나의 `SET LOCAL lock_timeout`(ms). 잠금 경합에서 매달리지 않기 위한 상한. */
  readonly lockTimeoutMs: number;
}

/** 정리 결과. */
export interface PurgeResult {
  /** 실제로 지운 행 수. */
  readonly deleted: number;
  /**
   * 실행한 배치(SQL 왕복) 수. 다 지웠는지 확인하는 마지막 빈 배치도 포함한다 —
   * 지울 것이 없으면 그 확인 시도 하나만 돌므로 1이고, `batchSize: 1`에 만료 행
   * 3개면 하나씩 지우는 세 번에 "더 없다"를 확인하는 한 번이 더해져 4다. 몇 번
   * 실제로 DB를 오갔는지를 그대로 보고하는 값이다.
   */
  readonly batches: number;
}

/**
 * 한 번의 잡 실행이 돌 수 있는 배치(DB 왕복) 수 상한.
 *
 * `SKIP LOCKED`가 제대로 도는 한 배치는 언젠가 빈 결과를 돌려주고 루프가 스스로
 * 멈춘다. 구현이 어긋나 진행 없이 배치가 끝없이 이어지는 회귀가 생기면, 이 상한이 없는
 * 한 잡이 워커 슬롯을 영원히 붙잡는다 — 그러면 상한을 넘겼다는 경고를 남기고 멈춘다.
 * "배치 하나가 지우는 행 수는 수백~수천대일 것"은 **측정값이 아니라 이 상한을 넉넉하게
 * 잡기 위해 세운 가정**이다 — 그 가정이 맞다면 10,000배치는 정상적인 정리가 걸릴 일이
 * 없을 만큼 큰 여유이고, 걸린다면 그 자체가 버그의 증거라는 뜻일 뿐, 이 가정 자체를
 * 다른 값(`PURGE_BATCH_SIZE` 등)의 근거로 재인용해서는 안 된다(`dispatch.ts`의
 * `PURGE_BATCH_SIZE` 참고 — 실제로 한 번 그렇게 재인용했다가 순환 근거가 됐었다).
 */
const MAX_BATCHES = 10_000;

/**
 * 배치 하나가 실행하는 실제 SQL. 모듈 내부(`runBatch`)와 통합 테스트 양쪽에서 쓴다.
 *
 * **브리프가 준 문장에서 벗어난 유일한 지점이다 — 그대로 쓰면 `LIMIT`이 지켜지지
 * 않는다.** 브리프의 원래 문장은:
 * ```sql
 * DELETE FROM refresh_sessions WHERE id IN (
 *   SELECT id FROM refresh_sessions WHERE expires_at < $1
 *   ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $2
 * ) RETURNING id
 * ```
 * 실측(PostgreSQL 18, 이 저장소의 `docker-compose.test.yml` 이미지와 동일 버전)으로
 * 확인한 결과: `DELETE`의 대상 테이블과 `IN` 서브쿼리의 대상 테이블이 같은
 * `refresh_sessions`이기 때문에, 플래너가 이 서브쿼리를 한 번만 계산해 두는 대신
 * "Nested Loop Semi Join"으로 바깥 스캔의 **후보 행 수만큼 서브쿼리를 반복 실행**한다
 * (`EXPLAIN ANALYZE`의 `Subquery Scan on "ANY_subquery" ... loops=N`이 그 증거다,
 * N은 그 시점의 후보 총 행 수). `FOR UPDATE SKIP LOCKED`가 없으면 이 반복 실행이
 * 매번 같은 결과를 내므로(부수효과가 없다) 우연히 정답이 나오지만, `FOR UPDATE`는
 * 행에 잠금을 남기는 부수효과가 있어 반복될 때마다 이전 잠금과 얽혀 **다른** 행을
 * 고른다 — 그 결과 `LIMIT $2`가 사실상 무시되고 조건에 맞는 후보가 하나씩 전부
 * 뽑혀 나간다. 만료 행 3개에 `LIMIT 1`을 줘도 3개가 한 배치에서 통째로 지워지는 것을
 * `docker exec ... psql`로 직접 확인했다(`EXPLAIN ANALYZE`에서
 * `Delete on refresh_sessions ... rows=2.00`처럼 `LIMIT`보다 많은 행이 실제로
 * 삭제됨을 봤다). 이 저장소가 겪은 "동시성 테스트가 실은 아무것도 검증하지 않던"
 * 사고와 결이 같다 — 이번엔 테스트가 아니라 배치 상한 자체가 지켜지지 않는 경우다.
 *
 * 고치는 법은 이 자기참조 서브쿼리를 `WITH ... AS MATERIALIZED (...)`로 감싸는
 * 것이다 — CTE는(특히 `FOR UPDATE`를 담고 있어 부수효과가 있는 CTE는) 플래너가
 * 상위 질의 안으로 접어 넣지 못하고 **한 번만 계산해 결과를 물질화**한다.
 * `EXPLAIN ANALYZE`로 다시 확인하면 `CTE candidates ... loops=1`로 바뀌고, 이후
 * 배치 3번을 연달아 돌려도 각각 정확히 1행만 지운다(3행 → 2 → 1 → 0). `SKIP LOCKED`가
 * 잠긴 행을 건너뛰는 것도, `lock_timeout`이 cascade 잠금 경합에서 55P03을 내는
 * 것도(다른 세션이 `replaced_by_id`가 가리키는 행을 잠근 상태에서 재현) 이 CTE
 * 버전으로 다시 실측해 동일하게 동작함을 확인했다 — `MATERIALIZED`는 실행 계획만
 * 바꿀 뿐 잠금·SKIP LOCKED 의미는 그대로다.
 *
 * 테스트가 이 상수를 직접 돌려 보는 또 다른 이유: `purgeExpiredRefreshSessions`는
 * 조건에 맞는 행을 빈 배치를 볼 때까지 전부 지우므로, 호출이 끝난 뒤의 DB 상태만
 * 보면 각 배치가 `expires_at` 오름차순으로 골랐는지(`ORDER BY`가 실제로 있는지)를
 * 구분할 수 없다 — 잠기지 않은 대상 행은 순서와 무관하게 어차피 전부 지워지기
 * 때문이다(배치 크기가 작으면 여러 배치에 걸릴 뿐, 함수가 반환할 때는 이미 다 지워진
 * 뒤다). 그래서 `ORDER BY`가 실제로 동작하는지는 이 문장 하나를 직접, 한 번만
 * 돌려서 확인한다 — `test/integration/purge-refresh-sessions.spec.ts`의 "오래된
 * 순서로 지운다" 테스트 참고. 이 상수를 내보내는 이유는 테스트가 별도로 베껴 적으면
 * 구현이 바뀔 때 조용히 어긋날 수 있기 때문이다 — 마이그레이션과 엔티티의 인덱스
 * 이름을 일치시키는 것과 같은 드리프트 방지 원칙이다.
 */
export const PURGE_BATCH_SQL = `
  WITH candidates AS MATERIALIZED (
    SELECT id FROM refresh_sessions WHERE expires_at < $1
    ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $2
  )
  DELETE FROM refresh_sessions WHERE id IN (SELECT id FROM candidates) RETURNING id
`;

/**
 * 만료된 refresh session을 오래된 순서로 배치 삭제한다.
 *
 * **`EntityManager`가 아니라 `DataSource`를 받는다** — 이 저장소의 다른 함수들
 * (`issueSession`·`rotateSession`·`upsertRow` 등)과 반대다. 배치마다 **커밋**해야
 * 하기 때문이다(스펙 10장): 한 트랜잭션으로 전부 지우면 대상 행 전체에 걸쳐 긴 잠금이
 * 걸리고, 중간에 실패하면 이미 지운 행까지 함께 롤백되어 한 행도 못 지운 것과 같다.
 * 배치마다 커밋하면 실패해도 그 전 배치가 지운 행은 남고, 다음 잡 실행이 이어서
 * 나머지를 지운다. 이 진행 보장을 만들려면 함수가 트랜잭션의 시작·커밋을 직접
 * 관리해야 하므로, 이미 트랜잭션 안에 있는 `EntityManager`가 아니라 배치마다 새
 * 커넥션·새 트랜잭션을 열 수 있는 `DataSource`를 받는다.
 *
 * **`lockTimeoutMs`가 필수인 이유(실측):** `refresh_sessions.replaced_by_id`는
 * `ON DELETE SET NULL`로 자기 테이블을 참조한다(`refresh-session.entity.ts`). 이
 * 배치가 만료된 행 B를 지우면, B를 가리키던 다른 행 A의 `replaced_by_id`를 NULL로
 * 되돌리기 위해 PostgreSQL이 A에도 잠금을 건다 — `SELECT ... FOR UPDATE SKIP LOCKED`는
 * **자기가 고른 행**(B)의 잠금만 피할 뿐, 이 cascade가 요구하는 A의 잠금은 막아 주지
 * 않는다(프로브가 500ms `lock_timeout`으로 55P03을 유도해 확인했다). 그래서 각 배치를
 * 짧은 `lock_timeout` 아래에서 돌리고, A가 다른 트랜잭션에 잠겨 있으면 그 배치는
 * 매달리는 대신 실패한다.
 *
 * **오류를 삼키지 않는다.** 배치 하나가 실패하면(lock_timeout으로 인한 55P03 포함)
 * 그대로 던진다. 이 함수를 부르는 BullMQ 잡은 그 오류로 재시도를 받는다(스펙 10장) —
 * 여기서 삼키면 남은 배치가 조용히 건너뛰어지고 아무도 그 사실을 모른다.
 */
export async function purgeExpiredRefreshSessions(
  dataSource: DataSource,
  options: PurgeOptions,
): Promise<PurgeResult> {
  const { retentionSeconds, batchSize, lockTimeoutMs } = options;

  // `SET LOCAL lock_timeout`에는 파라미터 자리표시자를 쓸 수 없다 — 값을 SQL 문자열에
  // 직접 이어 붙여야 한다(`runBatch` 참고). 검사 없이 이어 붙이면 그 자리가 주입
  // 표면이 된다. 이 값은 오늘은 설정에서 오지만, 호출자가 늘어나는 순간 그 전제가
  // 깨질 수 있으므로 함수 자신이 방어한다 — 문자열을 만들기 전에, 루프를 시작하기
  // 전에 먼저 확인한다.
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 0) {
    throw new TypeError(
      `lockTimeoutMs는 음이 아닌 정수여야 한다(받은 값: ${String(lockTimeoutMs)})`,
    );
  }

  // `batchSize`도 같은 이유로 방어한다 — 오늘은 `dispatch.ts`의 상수(500)에서만 오지만,
  // 이 함수는 호출자가 늘어날 것을 전제로 만들어졌다(위 `lockTimeoutMs` 검사와 같은
  // 근거). `0`을 그냥 통과시키면 `batchDeleted < batchSize`가 `0 < 0`으로 영원히
  // 거짓이 되어 매 배치가 아무것도 지우지 못한 채 `MAX_BATCHES`(10,000)까지 빈 왕복을
  // 반복한다 — 멈추기는 하지만 그 전까지 워커 슬롯 하나를 붙잡는다. 음수는 그대로
  // `LIMIT`에 실리면 PostgreSQL이 별도의 구문 오류로 거절하므로, 여기서 먼저 걸러
  // 원인이 분명한 오류로 바꾼다.
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError(`batchSize는 1 이상의 정수여야 한다(받은 값: ${String(batchSize)})`);
  }

  const cutoff = new Date(Date.now() - retentionSeconds * 1000);

  let deleted = 0;
  // 실행한 배치 수. 마지막에 "더 없다"를 확인하는 빈 배치까지 그대로 센다 — 지울
  // 대상이 정확히 batchSize의 배수만큼 있으면 그 확인 배치가 한 번 더 필요하기
  // 때문이다(SELECT는 LIMIT만큼 채울 수 있으면 반드시 채우므로, 빈 결과라야 비로소
  // "더 없다"는 것을 안다). 그래서 지울 것이 없으면 1(그 확인 시도 자체), 만료 행
  // 3개에 batchSize 1이면 4(하나씩 세 번 + 확인 한 번)다. 이 카운터가 곧 무한 루프
  // 방어 상한(`MAX_BATCHES`)과 비교하는 값이기도 하다 — 실제로 DB를 오간 횟수이므로
  // 별도 카운터를 둘 이유가 없다.
  let batches = 0;

  for (;;) {
    if (batches >= MAX_BATCHES) {
      logger.warn(
        `배치 상한(${String(MAX_BATCHES)})에 도달해 멈춘다 — ` +
          `deleted=${String(deleted)}, batches=${String(batches)}`,
      );
      break;
    }

    const batchDeleted = await runBatch(dataSource, cutoff, batchSize, lockTimeoutMs);
    batches += 1;
    deleted += batchDeleted;

    if (batchDeleted < batchSize) {
      // 요청한 것보다 적게 돌아왔다는 것은 조건에 맞는(그리고 잠기지 않은) 행이 더
      // 없다는 뜻이다 — SELECT는 LIMIT만큼 채울 수 있으면 반드시 채운다. 빈 배치(0행)도
      // 이 조건으로 잡힌다.
      break;
    }
  }

  return { deleted, batches };
}

/**
 * 배치 하나를 자기 트랜잭션 안에서 돌린다.
 *
 * 실패하면 그대로 던지되, 롤백과 release는 반드시 돈다 — `test/db/fixture.ts`의
 * `withRollback`과 같은 원칙이다. 커넥션을 여기서 새지 않아야 다음 배치도, 이 잡을
 * 동시에 도는 다른 워커도 커넥션 풀이 마르지 않는다.
 *
 * `SET LOCAL`은 현재 트랜잭션에만 적용되고 커밋·롤백과 함께 사라지므로, 이 값과 뒤이은
 * DELETE는 반드시 같은 `queryRunner`(같은 세션) 위에서 돌아야 한다 — 그래서 두 문장
 * 모두 `dataSource.query(sql, params, queryRunner)`의 3번째 인자로 이 트랜잭션의
 * `queryRunner`를 넘긴다(새 커넥션을 열지 않고 이 커넥션을 그대로 쓴다).
 *
 * **`dataSource.query`의 반환 모양.** TypeORM의 Postgres 드라이버는 `DELETE`/`UPDATE`
 * 문에 한해 `RETURNING`된 행 배열이 아니라 `[행 배열, 영향받은 행 수]` 튜플을
 * 돌려준다(`PostgresQueryRunner.query`가 `raw.command`로 분기하는 것을 소스에서
 * 확인했다) — `SELECT`였다면 행 배열 그대로였을 것이다. 튜플인 줄 모르고 그 결과에
 * 곧바로 `.length`를 부르면 실제 삭제 행 수가 몇이든 항상 2(튜플 자신의 길이)가
 * 나온다 — 처음 구현에서 정확히 이 실수로 배치가 끝없이 "가득 찼다"고 오판해
 * `MAX_BATCHES`까지 도는 것을 실측으로 잡았다. 그래서 첫 번째 원소만 구조 분해해
 * 그 배열의 길이를 쓴다.
 */
async function runBatch(
  dataSource: DataSource,
  cutoff: Date,
  batchSize: number,
  lockTimeoutMs: number,
): Promise<number> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await dataSource.query(
      `SET LOCAL lock_timeout = '${String(lockTimeoutMs)}ms'`,
      undefined,
      queryRunner,
    );
    const [rows] = await dataSource.query<[{ id: string }[], number]>(
      PURGE_BATCH_SQL,
      [cutoff, batchSize],
      queryRunner,
    );
    await queryRunner.commitTransaction();
    return rows.length;
  } catch (error: unknown) {
    try {
      await queryRunner.rollbackTransaction();
    } catch {
      // 롤백 실패를 삼킨다 — 원래 오류(대개 lock_timeout으로 인한 55P03)가 진단의
      // 근거인데, 여기서 새 오류가 나가면 그 원래 오류를 덮어버린다.
    }
    throw error;
  } finally {
    await queryRunner.release();
  }
}
