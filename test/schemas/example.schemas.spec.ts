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
  it('제목만으로 만들 수 있다', async () => {
    const dto = await validateAttributes(ExampleCreate, { title: '제목' });
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
      validateAttributes(ExampleCreate, { title: 'ㄱ'.repeat(200) }),
    ).resolves.toBeInstanceOf(ExampleCreate);
    await expect(validateAttributes(ExampleCreate, { title: 'ㄱ'.repeat(201) })).rejects.toThrow(
      JsonApiErrors,
    );
  });

  it('status는 엔티티의 enum 값만 받는다', async () => {
    for (const status of EXAMPLE_STATUSES) {
      await expect(
        validateAttributes(ExampleCreate, { title: '제목', status }),
      ).resolves.toBeInstanceOf(ExampleCreate);
    }
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', status: 'unknown' }),
    ).rejects.toThrow(JsonApiErrors);
  });

  it('publishedAt을 Date로 바꾼다', async () => {
    // 저장 계층은 Date를 받는다. 문자열을 그대로 넘기면 TypeORM이 조용히
    // 문자열을 저장하려다 드라이버 단계에서 터진다.
    const dto = await validateAttributes(ExampleCreate, {
      title: '제목',
      publishedAt: '2026-08-30T00:00:00.000Z',
    });
    expect(dto.publishedAt).toBeInstanceOf(Date);
  });

  it('publishedAt이 날짜가 아니면 거부한다', async () => {
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', publishedAt: '어제' }),
    ).rejects.toThrow(JsonApiErrors);
  });

  it('publishedAt에 null을 허용한다', async () => {
    const dto = await validateAttributes(ExampleCreate, { title: '제목', publishedAt: null });
    expect(dto.publishedAt).toBeNull();
  });

  it('NOT NULL 컬럼인 status에 null을 거부한다', async () => {
    // `@IsOptional()`이면 null이 검증을 전부 건너뛰어 DB까지 내려가고 500이 된다.
    // 사용자 입력 오류이므로 여기서 422로 끝나야 한다.
    const errors = await caught(() =>
      validateAttributes(ExampleCreate, { title: '제목', status: null }),
    );
    expect(errors.errors[0]?.source).toEqual({ pointer: '/data/attributes/status' });
  });

  it('내부 FK를 입력으로 받지 않는다', async () => {
    // 스펙 7.3: 내부 FK를 공개 입력으로 만들지 않는다. 관계는 relationships로만 바꾼다.
    await expect(
      validateAttributes(ExampleCreate, { title: '제목', categoryId: 'x' }),
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
  });

  it('nullable 컬럼에는 null을 허용한다', async () => {
    // body와 published_at은 nullable이다. 여기서 null은 "비운다"는 뜻이고,
    // README가 안내하는 부분 수정 방식이 이것이다.
    const dto = await validateAttributes(ExampleUpdate, { body: null, publishedAt: null });
    expect(dto.body).toBeNull();
    expect(dto.publishedAt).toBeNull();
  });

  it('보내지 않은 title은 그대로 통과한다', async () => {
    // null 거부가 "title을 언제나 요구한다"로 번지면 부분 갱신이 깨진다.
    const dto = await validateAttributes(ExampleUpdate, { body: '본문' });
    expect(dto.title).toBeUndefined();
  });
});

describe('ExampleReplace', () => {
  it('생성과 같은 필수 조건을 건다', async () => {
    // PUT은 전체 교체이므로 보내지 않은 필드는 기본값으로 돌아간다.
    await expect(validateAttributes(ExampleReplace, {})).rejects.toThrow(JsonApiErrors);
    await expect(validateAttributes(ExampleReplace, { title: '제목' })).resolves.toBeInstanceOf(
      ExampleReplace,
    );
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
