import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { JsonApiError, JsonApiErrors } from '../../src/app/jsonapi/errors.js';
import { schemaProperties, validateAttributes } from '../../src/app/schemas/write-schema.js';

class Sample {
  @IsString()
  @Length(1, 10)
  title!: string;

  @IsOptional()
  @IsInt()
  size?: number;
}

class Child {
  @IsString()
  @Length(1, 5)
  name!: string;
}

class Parent {
  @IsString()
  title!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => Child)
  child?: Child;
}

/** `extends` 상속의 부모. `Derived`가 이 클래스의 필드를 물려받는다. */
class Base {
  @IsString()
  title!: string;
}

/** `Base`를 `extends`한 자식. 자기 필드(`size`)와 물려받은 필드(`title`)를 함께 갖는다. */
class Derived extends Base {
  @IsOptional()
  @IsInt()
  size?: number;
}

/** 집합 오류가 아니면 다시 던져 테스트를 실패시킨다. */
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

describe('validateAttributes', () => {
  it('유효한 값을 스키마 인스턴스로 돌려준다', async () => {
    const result = await validateAttributes(Sample, { title: '제목', size: 3 });
    expect(result).toBeInstanceOf(Sample);
    expect(result.title).toBe('제목');
    expect(result.size).toBe(3);
  });

  it('선택 필드를 생략해도 통과한다', async () => {
    expect((await validateAttributes(Sample, { title: '제목' })).size).toBeUndefined();
  });

  it('검증 실패를 VALIDATION_ERROR로 낸다', async () => {
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    expect(aggregate.errors).toHaveLength(1);
    expect(aggregate.errors[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('실패한 필드를 pointer로 가리킨다', async () => {
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    expect(aggregate.errors[0]?.source).toEqual({ pointer: '/data/attributes/title' });
  });

  it('여러 필드가 틀리면 모두 담는다', async () => {
    // 하나씩 알려 주면 클라이언트가 고칠 때마다 왕복해야 한다.
    const aggregate = await caught(() => validateAttributes(Sample, { title: '', size: 'x' }));
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors.map((error) => error.source?.pointer).sort()).toEqual([
      '/data/attributes/size',
      '/data/attributes/title',
    ]);
  });

  it('선언되지 않은 필드를 거부한다', async () => {
    // `forbidNonWhitelisted`가 Pydantic의 `extra="forbid"`에 해당한다. 조용히 버리면
    // 오타 난 필드가 무시된 채 저장되고, 클라이언트는 반영됐다고 읽는다.
    const aggregate = await caught(() => validateAttributes(Sample, { title: '제목', extra: 1 }));
    expect(aggregate.errors[0]?.source).toEqual({ pointer: '/data/attributes/extra' });
  });

  // class-validator 의 영문 문구를 응답에 싣지 않는다. 그 문구는 협상되지 않아
  // `Accept-Language: ko` 를 줘도 영문이 나갔고, 값을 끼워 넣는 제약에서는 사용자
  // 입력이 그대로 실렸다. 어느 입력이 틀렸는지는 `source.pointer` 가 말한다.
  it('class-validator 문구를 오류에 싣지 않는다', async () => {
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    const [error] = aggregate.errors;

    expect(error?.source).toEqual({ pointer: '/data/attributes/title' });
    expect(JSON.stringify(error)).not.toContain('must be longer');
  });

  it('던지는 것은 언제나 JsonApiErrors다', async () => {
    // 하나만 틀렸을 때도 집합으로 던져야 잡는 쪽이 분기하지 않는다.
    const aggregate = await caught(() => validateAttributes(Sample, { title: '' }));
    expect(aggregate).toBeInstanceOf(JsonApiErrors);
    expect(aggregate.errors[0]).toBeInstanceOf(JsonApiError);
  });

  it('중첩 필드의 pointer가 부모 경로를 유지한다', async () => {
    // 부모를 잃으면 `/data/attributes/name`을 가리키게 되는데, 그런 최상위 필드는
    // 존재하지 않는다 — 클라이언트가 고칠 곳을 못 찾는다.
    const aggregate = await caught(() =>
      validateAttributes(Parent, { title: '제목', child: { name: '' } }),
    );
    expect(aggregate.errors[0]?.source).toEqual({ pointer: '/data/attributes/child/name' });
  });

  it('중첩 오류와 최상위 오류를 함께 담는다', async () => {
    const aggregate = await caught(() =>
      validateAttributes(Parent, { title: 3, child: { name: '' } }),
    );
    expect(aggregate.errors.map((error) => error.source?.pointer).sort()).toEqual([
      '/data/attributes/child/name',
      '/data/attributes/title',
    ]);
  });
});

describe('schemaProperties', () => {
  it('데코레이터가 붙은 필드 이름을 모두 돌려준다', () => {
    expect([...schemaProperties(Sample)].sort()).toEqual(['size', 'title']);
  });

  it('같은 필드에 데코레이터가 여러 개여도 한 번만 센다', () => {
    // `Sample.title`에는 `@IsString()`과 `@Length()`가 붙어 있다.
    expect(schemaProperties(Sample).filter((name) => name === 'title')).toHaveLength(1);
  });

  it('중첩 스키마의 자식 필드는 부모 목록에 넣지 않는다', () => {
    // `Parent`가 소유하는 것은 `title`과 `child`이지 `child.name`이 아니다.
    // 자식의 기본값은 자식 스키마가 정할 일이다.
    expect([...schemaProperties(Parent)].sort()).toEqual(['child', 'title']);
  });

  it('extends로 상속한 필드도 함께 돌려준다', () => {
    // 위 중첩 스키마 테스트는 "합성"(필드로 다른 스키마를 갖는 것)만 본다. 이 테스트가
    // 보는 것은 `extends` "상속"이다 — `Derived`는 자기 필드(`size`)뿐 아니라 `Base`의
    // `title`도 소유한다. 부모의 필드를 빠뜨리면 그 필드가 PUT 교체 대상에서 조용히
    // 빠지므로, 상속 체인을 걷는 동작 자체를 여기서 붙잡는다.
    expect([...schemaProperties(Derived)].sort()).toEqual(['size', 'title']);
  });

  it('데코레이터가 없는 클래스는 빈 목록이다', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class Bare {}
    expect(schemaProperties(Bare)).toEqual([]);
  });
});
