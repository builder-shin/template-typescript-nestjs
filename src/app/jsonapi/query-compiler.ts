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

async function countTotal<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
): Promise<number> {
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
      ? {
          firstCursor: encodeCursor(
            sortSignature(parsed.sort),
            cursorValues(builder, parsed.sort, first),
          ),
        }
      : {}),
    ...(page.mode === 'cursor' && last !== undefined
      ? {
          lastCursor: encodeCursor(
            sortSignature(parsed.sort),
            cursorValues(builder, parsed.sort, last),
          ),
        }
      : {}),
  };
}
