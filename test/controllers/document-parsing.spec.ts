import { IsOptional, IsString, Length } from 'class-validator';
import {
  applyAttributes,
  parseWriteDocument,
} from '../../src/app/controllers/concerns/document-parsing.js';
import { JsonApiError, JsonApiErrors } from '../../src/app/jsonapi/errors.js';

class Sample {
  @IsOptional()
  @IsString()
  @Length(1, 10)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string | null;
}

function document(data: Record<string, unknown>): unknown {
  return { data: { type: 'samples', ...data } };
}

async function caughtError(run: () => Promise<unknown>): Promise<JsonApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof JsonApiErrors && error.errors[0] !== undefined) return error.errors[0];
    if (!(error instanceof JsonApiError)) {
      throw error;
    }
    return error;
  }
  throw new Error('오류가 던져지지 않았다');
}

describe('parseWriteDocument', () => {
  it('검증을 마친 attributes를 돌려준다', async () => {
    const parsed = await parseWriteDocument(document({ attributes: { title: '제목' } }), Sample, {
      expectedType: 'samples',
    });
    expect(parsed.attributes).toBeInstanceOf(Sample);
    expect(parsed.attributes.title).toBe('제목');
  });

  it('요청이 실제로 보낸 키만 presentKeys에 담는다', async () => {
    // 스펙 7.1의 핵심. 스키마에 선언된 필드가 아니라 요청이 보낸 키다.
    const parsed = await parseWriteDocument(document({ attributes: { title: '제목' } }), Sample, {
      expectedType: 'samples',
    });
    expect([...parsed.presentKeys]).toEqual(['title']);
  });

  it('null로 보낸 필드도 보낸 것으로 센다', async () => {
    // "보내지 않음"과 "null로 보냄"을 가르는 것이 이 계층의 존재 이유다.
    const parsed = await parseWriteDocument(document({ attributes: { body: null } }), Sample, {
      expectedType: 'samples',
    });
    expect(parsed.presentKeys.has('body')).toBe(true);
    expect(parsed.attributes.body).toBeNull();
  });

  it('attributes가 아예 없으면 presentKeys가 빈다', async () => {
    const parsed = await parseWriteDocument(document({ attributes: {} }), Sample, {
      expectedType: 'samples',
    });
    expect(parsed.presentKeys.size).toBe(0);
  });

  it('relationships를 그대로 넘긴다', async () => {
    const parsed = await parseWriteDocument(
      document({ attributes: {}, relationships: { owner: { data: { type: 'users', id: 'u1' } } } }),
      Sample,
      { expectedType: 'samples' },
    );
    expect(parsed.relationships.owner).toEqual({ data: { type: 'users', id: 'u1' } });
  });

  it('문서의 id를 돌려준다', async () => {
    const parsed = await parseWriteDocument(
      document({ id: 's1', attributes: { title: '제목' } }),
      Sample,
      { expectedType: 'samples', expectedId: 's1' },
    );
    expect(parsed.id).toBe('s1');
  });

  it('문서 구조 오류를 그대로 올려보낸다', async () => {
    // 구조 판정은 `parseResourceInput`이 소유한다. 여기서 다시 만들지 않는다.
    const error = await caughtError(() =>
      parseWriteDocument({ data: null }, Sample, { expectedType: 'samples' }),
    );
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('타입이 다르면 TYPE_MISMATCH다', async () => {
    const error = await caughtError(() =>
      parseWriteDocument({ data: { type: 'others', attributes: {} } }, Sample, {
        expectedType: 'samples',
      }),
    );
    expect(error.code).toBe('TYPE_MISMATCH');
  });

  it('값 검증 실패는 VALIDATION_ERROR 집합이다', async () => {
    // 400(구조)과 422(값)의 경계가 이 두 테스트로 고정된다.
    await expect(
      parseWriteDocument(document({ attributes: { title: '' } }), Sample, {
        expectedType: 'samples',
      }),
    ).rejects.toThrow(JsonApiErrors);
  });
});

describe('applyAttributes', () => {
  it('보낸 키만 옮긴다', () => {
    const entity = { title: '원래 제목', body: '원래 본문' };
    applyAttributes(entity, { title: '새 제목', body: '새 본문' }, new Set(['title']));
    expect(entity).toEqual({ title: '새 제목', body: '원래 본문' });
  });

  it('null도 옮긴다', () => {
    const entity: { body: string | null } = { body: '원래 본문' };
    applyAttributes(entity, { body: null }, new Set(['body']));
    expect(entity.body).toBeNull();
  });

  it('보낸 키인데 스키마에 없으면 건너뛴다', () => {
    // whitelist가 걸러낸 뒤라 정상 경로에서는 일어나지 않지만, 여기서 조용히
    // undefined를 덮어쓰면 멀쩡한 값이 지워진다.
    const entity = { title: '원래 제목' };
    applyAttributes(entity, {}, new Set(['title']));
    expect(entity.title).toBe('원래 제목');
  });

  it('보내지 않은 키는 건드리지 않는다', () => {
    const entity = { title: '원래 제목' };
    applyAttributes(entity, { title: '새 제목' }, new Set());
    expect(entity.title).toBe('원래 제목');
  });
});
