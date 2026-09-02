import {
  assertCursorSortable,
  decodeCursor,
  encodeCursor,
  keysetPredicate,
} from '../../src/app/jsonapi/cursor.js';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import type { ResolvedSort } from '../../src/app/jsonapi/sort.js';

const SORT: ResolvedSort[] = [
  { field: 'createdAt', property: 'createdAt', direction: 'DESC', nullable: false },
  { field: 'id', property: 'id', direction: 'ASC', nullable: false },
];

const SIGNATURE = '-createdAt,id';

function caught(run: () => unknown): JsonApiError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('encodeCursor / decodeCursor', () => {
  it('왕복한다', () => {
    const cursor = encodeCursor(SIGNATURE, ['2026-08-30T00:00:00.000Z', 'e1']);
    expect(decodeCursor(cursor, SIGNATURE, 2)).toEqual(['2026-08-30T00:00:00.000Z', 'e1']);
  });

  it('URL에 그대로 넣을 수 있는 문자만 쓴다', () => {
    const cursor = encodeCursor(SIGNATURE, ['가 나', 'e1']);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('정렬이 달라진 커서를 거부한다', () => {
    // 커서를 다른 정렬 축에 대고 비교하면 결과가 조용히 어긋난다.
    const cursor = encodeCursor('title,id', ['제목', 'e1']);
    const error = caught(() => decodeCursor(cursor, SIGNATURE, 2));
    expect(error.code).toBe('INVALID_PAGE');
    expect(error.source).toEqual({ parameter: 'page[after]' });
  });

  it('항목 수가 정렬과 다른 커서를 거부한다', () => {
    const cursor = encodeCursor(SIGNATURE, ['2026-08-30T00:00:00.000Z']);
    expect(caught(() => decodeCursor(cursor, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('base64url이 아닌 문자열을 거부한다', () => {
    expect(caught(() => decodeCursor('!!!not-base64!!!', SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('JSON이 아닌 커서를 거부한다', () => {
    const broken = Buffer.from('그냥 글자', 'utf8').toString('base64url');
    expect(caught(() => decodeCursor(broken, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('모양이 다른 JSON 커서를 거부한다', () => {
    const broken = Buffer.from(JSON.stringify({ sort: SIGNATURE }), 'utf8').toString('base64url');
    expect(caught(() => decodeCursor(broken, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('값에 문자열이 아닌 것이 섞이면 거부한다', () => {
    const broken = Buffer.from(
      JSON.stringify({ sort: SIGNATURE, values: ['a', 3] }),
      'utf8',
    ).toString('base64url');
    expect(caught(() => decodeCursor(broken, SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });

  it('빈 커서를 거부한다', () => {
    expect(caught(() => decodeCursor('', SIGNATURE, 2)).code).toBe('INVALID_PAGE');
  });
});

describe('assertCursorSortable', () => {
  it('NULL을 허용하지 않는 정렬은 통과한다', () => {
    expect(() => {
      assertCursorSortable(SORT);
    }).not.toThrow();
  });

  it('nullable 정렬 컬럼을 INVALID_PAGE로 거부한다', () => {
    // keyset 비교에 NULL이 섞이면 비교가 unknown이 되어 행을 조용히 건너뛴다.
    const nullable: ResolvedSort[] = [
      { field: 'publishedAt', property: 'publishedAt', direction: 'ASC', nullable: true },
      ...SORT.slice(1),
    ];
    const error = caught(() => {
      assertCursorSortable(nullable);
    });
    expect(error.code).toBe('INVALID_PAGE');
  });
});

describe('keysetPredicate', () => {
  it('after는 정렬 방향대로 부등호를 고른다', () => {
    const predicate = keysetPredicate('e', SORT, ['2026-08-30T00:00:00.000Z', 'e1'], 'after');
    // createdAt DESC이므로 뒤로 가려면 더 작은 값, id ASC이므로 더 큰 값.
    expect(predicate.clause).toBe(
      '((e.createdAt < :cursor0) OR (e.createdAt = :cursor0 AND e.id > :cursor1))',
    );
    expect(predicate.parameters).toEqual({
      cursor0: '2026-08-30T00:00:00.000Z',
      cursor1: 'e1',
    });
  });

  it('before는 부등호를 뒤집는다', () => {
    const predicate = keysetPredicate('e', SORT, ['2026-08-30T00:00:00.000Z', 'e1'], 'before');
    expect(predicate.clause).toBe(
      '((e.createdAt > :cursor0) OR (e.createdAt = :cursor0 AND e.id < :cursor1))',
    );
  });

  it('정렬 항목이 하나면 비교도 하나다', () => {
    const single: ResolvedSort[] = [
      { field: 'id', property: 'id', direction: 'ASC', nullable: false },
    ];
    expect(keysetPredicate('e', single, ['e1'], 'after').clause).toBe('((e.id > :cursor0))');
  });

  it('정렬 항목이 셋이면 사전식으로 펼친다', () => {
    const three: ResolvedSort[] = [
      { field: 'a', property: 'a', direction: 'ASC', nullable: false },
      { field: 'b', property: 'b', direction: 'DESC', nullable: false },
      { field: 'id', property: 'id', direction: 'ASC', nullable: false },
    ];
    expect(keysetPredicate('e', three, ['1', '2', '3'], 'after').clause).toBe(
      '((e.a > :cursor0) OR (e.a = :cursor0 AND e.b < :cursor1) OR ' +
        '(e.a = :cursor0 AND e.b = :cursor1 AND e.id > :cursor2))',
    );
  });

  it('컬럼 이름은 정렬 항목의 property에서만 나온다', () => {
    // 사용자 입력이 열 이름이 되는 경로가 없다는 것을 고정한다.
    const predicate = keysetPredicate('e', SORT, ['x', 'y'], 'after');
    expect(predicate.clause).not.toContain('createdAtField');
    expect(predicate.clause).toContain('e.createdAt');
  });
});
