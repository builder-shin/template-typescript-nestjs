import { EXAMPLE_STATUSES } from '../../src/app/models/example.entity.js';
import { JsonApiErrors } from '../../src/app/jsonapi/errors.js';
import {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleReplace,
  ExampleUpdate,
} from '../../src/app/schemas/example.schemas.js';
import { validateAttributes } from '../../src/app/schemas/write-schema.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';

async function caught(run: () => Promise<unknown>): Promise<JsonApiErrors> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof JsonApiErrors)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('ExampleCreate', () => {
  it('필수 필드를 모두 보내면 만들 수 있다', async () => {
    // status·score가 필수가 되면서 더 이상 "제목만으로" 만들 수 없다 — 아래
    // "생성에서 status를 생략하면 거절한다"가 그 경계를 고정한다.
    const dto = await validateAttributes(ExampleCreate, {
      title: '제목',
      status: 'draft',
      score: 0,
    });
    expect(dto.title).toBe('제목');
  });

  it('제목이 없으면 거부한다', async () => {
    expect((await caught(() => validateAttributes(ExampleCreate, {}))).errors[0]?.source).toEqual({
      pointer: '/data/attributes/title',
    });
  });

  it('제목 길이 상한이 엔티티 컬럼과 같다', async () => {
    // 스키마가 더 느슨하면 DB가 거절하고 500이 나간다.
    await expect(
      validateAttributes(ExampleCreate, { title: 'ㄱ'.repeat(200), status: 'draft', score: 0 }),
    ).resolves.toBeInstanceOf(ExampleCreate);
    await expect(
      validateAttributes(ExampleCreate, {
        title: 'ㄱ'.repeat(201),
        status: 'draft',
        score: 0,
      }),
    ).rejects.toThrow(JsonApiErrors);
  });

  it('status는 엔티티의 enum 값만 받는다', async () => {
    for (const status of EXAMPLE_STATUSES) {
      await expect(
        validateAttributes(ExampleCreate, { title: '제목', status, score: 0 }),
      ).resolves.toBeInstanceOf(ExampleCreate);
    }
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', status: 'unknown', score: 0 }),
    ).rejects.toThrow(JsonApiErrors);
  });

  it('NOT NULL 컬럼인 status에 null을 거부한다', async () => {
    // `@IsOptional()`이면 null이 검증을 전부 건너뛰어 DB까지 내려가고 500이 된다.
    // 사용자 입력 오류이므로 여기서 422로 끝나야 한다.
    const errors = await caught(() =>
      validateAttributes(ExampleCreate, { title: '제목', status: null, score: 0 }),
    );
    expect(errors.errors[0]?.source).toEqual({ pointer: '/data/attributes/status' });
  });

  it('생성에서 status를 생략하면 거절한다', async () => {
    // 정본이 생성에서 status를 필수로 받는다. 여기서 선택이면 같은 요청이
    // 정본에서는 422, 여기서는 201이 되어 wire가 갈라진다.
    await expect(validateAttributes(ExampleCreate, { title: '제목', score: 10 })).rejects.toThrow();
  });

  it('score 범위 밖을 거절한다', async () => {
    // DB의 CHECK 제약만 있으면 위반이 500으로 나간다. 스키마에서 먼저 잡는다.
    await expect(
      validateAttributes(ExampleCreate, {
        title: '제목',
        status: 'draft',
        score: 101,
      }),
    ).rejects.toThrow();
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', status: 'draft', score: -1 }),
    ).rejects.toThrow();
  });

  it('nullable 컬럼인 description에 null을 허용한다', async () => {
    // `@IsOptional()`이 붙은 nullable attribute는 명시적 `null`을 "비운다"로 받는다.
    // 이 자리를 `@ValidateIf(isPresent)`로 바꾸면 정본에서 201인 요청이 여기서만
    // 422가 되어 wire가 갈라진다 — 그 회귀를 잡는 것이 이 테스트다.
    const dto = await validateAttributes(ExampleCreate, {
      title: '제목',
      description: null,
      status: 'draft',
      score: 0,
    });
    expect(dto.description).toBeNull();
  });

  it('내부 FK를 입력으로 받지 않는다', async () => {
    // 스펙 7.3: 내부 FK를 공개 입력으로 만들지 않는다. 관계는 relationships로만 바꾼다.
    await expect(
      validateAttributes(ExampleCreate, {
        title: '제목',
        status: 'draft',
        score: 0,
        categoryId: 'x',
      }),
    ).rejects.toThrow(JsonApiErrors);
  });
});

describe('ExampleUpdate', () => {
  it('모든 필드가 선택이다', async () => {
    // PATCH는 보낸 필드만 바꾼다. 필수 필드를 두면 부분 갱신이 불가능해진다.
    await expect(validateAttributes(ExampleUpdate, {})).resolves.toBeInstanceOf(ExampleUpdate);
  });

  it('보낸 필드는 여전히 검증한다', async () => {
    await expect(validateAttributes(ExampleUpdate, { title: '' })).rejects.toThrow(JsonApiErrors);
  });

  it('NOT NULL 컬럼에 null을 거부한다', async () => {
    // 컬럼이 NOT NULL이므로 "비운다"가 성립하지 않는다. 통과시키면 PostgreSQL이
    // 거절해 422여야 할 것이 500으로 나간다.
    const title = await caught(() => validateAttributes(ExampleUpdate, { title: null }));
    expect(title.errors[0]?.source).toEqual({ pointer: '/data/attributes/title' });
    const status = await caught(() => validateAttributes(ExampleUpdate, { status: null }));
    expect(status.errors[0]?.source).toEqual({ pointer: '/data/attributes/status' });
    const score = await caught(() => validateAttributes(ExampleUpdate, { score: null }));
    expect(score.errors[0]?.source).toEqual({ pointer: '/data/attributes/score' });
  });

  it('nullable 컬럼에는 null을 허용한다', async () => {
    // description은 nullable이다. 여기서 null은 "비운다"는 뜻이고,
    // README가 안내하는 부분 수정 방식이 이것이다.
    const dto = await validateAttributes(ExampleUpdate, { description: null });
    expect(dto.description).toBeNull();
  });

  it('보내지 않은 title은 그대로 통과한다', async () => {
    // null 거부가 "title을 언제나 요구한다"로 번지면 부분 갱신이 깨진다.
    const dto = await validateAttributes(ExampleUpdate, { description: '본문' });
    expect(dto.title).toBeUndefined();
  });
});

describe('ExampleReplace', () => {
  it('생성과 같은 필수 조건을 건다', async () => {
    // PUT은 전체 교체이므로 보내지 않은 필드는 기본값으로 돌아간다. title뿐 아니라
    // status·score도 생성과 똑같이 필수다 — 하나라도 빠지면 거절해야 한다.
    await expect(validateAttributes(ExampleReplace, {})).rejects.toThrow(JsonApiErrors);
    await expect(validateAttributes(ExampleReplace, { title: '제목' })).rejects.toThrow(
      JsonApiErrors,
    );
    await expect(
      validateAttributes(ExampleReplace, { title: '제목', status: 'draft', score: 0 }),
    ).resolves.toBeInstanceOf(ExampleReplace);
  });
});

describe('EXAMPLE_RELATIONSHIPS', () => {
  it('쓸 수 있는 관계를 선언한다', () => {
    expect(Object.keys(EXAMPLE_RELATIONSHIPS).sort()).toEqual(['category', 'tags']);
  });

  it('cardinality가 시리얼라이저 선언과 일치한다', () => {
    // 두 선언이 갈리면 to-one 관계에 배열 라우트가 생기거나 그 반대가 된다.
    for (const [name, rule] of Object.entries(EXAMPLE_RELATIONSHIPS)) {
      expect(rule.cardinality).toBe(EXAMPLE_SERIALIZER.relationships[name]?.cardinality);
    }
  });

  it('JSON:API type이 대상 시리얼라이저와 일치한다', () => {
    for (const [name, rule] of Object.entries(EXAMPLE_RELATIONSHIPS)) {
      expect(rule.type).toBe(EXAMPLE_SERIALIZER.relationships[name]?.target().type);
    }
  });
});
