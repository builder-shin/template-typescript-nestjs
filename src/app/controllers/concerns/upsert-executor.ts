import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

/**
 * `PUT` upsert의 원자적 부분.
 *
 * 이 파일은 두 가지만 한다 — **id를 원자적으로 차지하고, 그것이 생성이었는지 교체였는지
 * 알려 준다.** 관계 조인 행·훅·`@UpdateDateColumn`은 호출자가 같은 트랜잭션 안에서 이미
 * 검증된 `save()` 경로로 처리한다. 여기서 전부 하려 들면 Phase 4가 테스트해 둔 경로를
 * 우회하는 두 번째 저장 경로가 생긴다.
 *
 * 잠금은 `pg_advisory_xact_lock`이다. **트랜잭션 스코프**라 호출자의 트랜잭션이 끝나면
 * 자동으로 풀린다 — 풀어 주는 코드를 잊을 자리가 없다. 세션 스코프 잠금을 쓰면 커넥션이
 * 풀에 돌아간 뒤에도 잠금이 남아, 다음에 그 커넥션을 받은 요청이 이유 없이 막힌다.
 *
 * 생성/교체 판정은 `RETURNING (xmax = 0)`이 한다. PostgreSQL은 방금 삽입한 튜플의
 * `xmax`를 0으로 두고, `ON CONFLICT DO UPDATE`가 갱신한 튜플에는 갱신 트랜잭션의 id를
 * 넣는다. 사전 조회로 판정하지 않는 이유는 스펙 7.2의 요구이기도 하고, 판정을 문장
 * 밖으로 빼면 그 문장이 원자적이라는 사실이 설계에서 사라지기 때문이기도 하다.
 */

/** upsert 결과. */
export interface UpsertOutcome {
  /** 이번 요청이 행을 만들었는가. `false`면 교체했다는 뜻이다. */
  readonly created: boolean;
}

/**
 * 보내지 않은 필드를 무엇으로 되돌릴지 정한다.
 *
 * 컬럼 기본값이 있으면 그 값, 없고 nullable이면 `null`이다. 둘 다 아니면 되돌릴 값이
 * 없다는 뜻이고, 그것은 교체 스키마가 그 필드를 필수로 선언했어야 한다는 선언 실수다.
 */
function resetValueFor(column: ColumnMetadata): unknown {
  if (column.default !== undefined) {
    return column.default;
  }
  if (column.isNullable) {
    return null;
  }
  throw new TypeError(
    `"${column.propertyName}"은(는) NOT NULL이고 컬럼 기본값도 없어 되돌릴 값이 없다. 교체 스키마에서 필수 필드로 선언해야 한다`,
  );
}

/**
 * 전체 교체가 쓸 값 묶음을 만든다.
 *
 * 스키마가 소유한 필드 전부를 담되, 요청이 보내지 않은 것은 기본값으로 되돌린다.
 * 이것이 `PUT`과 `PATCH`가 갈리는 지점이다 — `PATCH`는 보낸 것만 옮기고, `PUT`은
 * 보내지 않은 것까지 되돌린다.
 *
 * "보냈는가"의 판정은 `presentKeys`(원본 요청의 `data.attributes` 키 집합,
 * `document.ts`가 만든다)로만 한다. `property in attributes`로 판정하면 안 된다 —
 * 이 tsconfig(`target: ES2023`)는 `useDefineForClassFields`가 기본 켜짐이라, 초기값
 * 없는 선언 필드도 `plainToInstance`가 만든 인스턴스에 own 프로퍼티로 **존재한다**
 * (값은 `undefined`). 그래서 `attributes`가 스키마 인스턴스라면 스키마가 소유한
 * 프로퍼티 전부가 언제나 `in`에 참이 되어 이 함수의 되돌림 사다리(`resetValueFor`)가
 * 실제 요청 경로에서 통째로 죽는다 — 보내지 않은 NOT NULL 필드도 `undefined`가 그대로
 * `values`에 실려 `SET col = DEFAULT`로 나가고, 기본값이 없으면 Postgres가 23502로
 * 죽는다. `applyAttributes`(document-parsing.ts)가 같은 이유로 `presentKeys`를 쓰는
 * 것과 정확히 같은 문제다.
 */
export function replacementValues<T extends ObjectLiteral>(
  manager: EntityManager,
  model: EntityTarget<T>,
  attributes: object,
  presentKeys: ReadonlySet<string>,
  ownedProperties: readonly string[],
): Record<string, unknown> {
  const metadata = manager.dataSource.getMetadata(model);
  const values: Record<string, unknown> = {};

  for (const property of ownedProperties) {
    const column = metadata.findColumnWithPropertyName(property);
    if (column === undefined) {
      throw new TypeError(`교체 스키마의 "${property}"에 대응하는 컬럼이 없다`);
    }
    if (presentKeys.has(property)) {
      const value: unknown = Reflect.get(attributes, property);
      values[property] = value;
      continue;
    }
    values[property] = resetValueFor(column);
  }

  return values;
}

/**
 * 같은 id를 직렬화한 채로 행을 만들거나 교체한다. 호출자가 트랜잭션을 소유한다.
 *
 * `values`의 키는 **프로퍼티 이름**이고 `orUpdate`에 넘기는 것은 **DB 컬럼 이름**이다.
 * 둘을 섞으면 갱신 절이 비어 조용히 아무것도 바뀌지 않는다.
 */
export async function upsertRow<T extends ObjectLiteral & { id: string }>(
  manager: EntityManager,
  model: EntityTarget<T>,
  id: string,
  values: Readonly<Record<string, unknown>>,
): Promise<UpsertOutcome> {
  const properties = Object.keys(values);
  if (properties.length === 0) {
    throw new TypeError('upsert에 갱신할 값이 하나도 없다');
  }

  const metadata = manager.dataSource.getMetadata(model);
  const updatable = properties.map((property) => {
    const column = metadata.findColumnWithPropertyName(property);
    if (column === undefined) {
      throw new TypeError(`"${property}"에 대응하는 컬럼이 없다`);
    }
    return column.databaseName;
  });

  // 같은 id에 대한 요청을 이 트랜잭션이 끝날 때까지 직렬화한다. `hashtext`는 임의
  // 문자열을 advisory 잠금이 받는 정수로 접는다 — 충돌하면 서로 다른 id가 같은 잠금을
  // 나눠 갖게 되지만, 그 결과는 불필요한 대기일 뿐 정확성을 해치지 않는다.
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);

  const result = await manager
    .createQueryBuilder()
    .insert()
    .into<ObjectLiteral>(model)
    .values({ ...values, id })
    .orUpdate(updatable, ['id'])
    .returning('(xmax = 0) AS inserted')
    .execute();

  const raw: unknown = result.raw;
  if (!Array.isArray(raw)) {
    throw new TypeError('upsert가 RETURNING 결과를 돌려주지 않았다');
  }
  // `raw`는 `Array.isArray`로 이미 배열로 좁혀졌다 — `unknown[]`으로 받으면 캐스트 없이
  // 인덱싱할 수 있다.
  const rows: unknown[] = raw;
  const [row] = rows;
  if (typeof row !== 'object' || row === null || !('inserted' in row)) {
    throw new TypeError('upsert의 RETURNING 결과에 inserted가 없다');
  }
  const inserted: unknown = Reflect.get(row, 'inserted');
  if (typeof inserted !== 'boolean') {
    throw new TypeError('upsert의 inserted가 참거짓이 아니다');
  }

  return { created: inserted };
}
