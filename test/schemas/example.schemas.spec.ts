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
