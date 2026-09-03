import { CrudActions } from '../../src/app/controllers/concerns/crud-actions.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleReplace,
  ExampleUpdate,
} from '../../src/app/schemas/example.schemas.js';
import type { RelationshipWriteSchema } from '../../src/app/schemas/write-schema.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';

/**
 * 조립 시점 검사만 확인한다.
 *
 * 여기서 잡지 못한 선언 실수는 요청이 들어와야 드러나고, 그때는 이미 행이 커밋된
 * 뒤일 수 있다. DB가 필요 없는 것은 이 검사들이 모두 팩토리 호출 자체에서 끝나기
 * 때문이다 — 실제 요청 경로는 `test/integration/`이 맡는다.
 */

/** `ExamplesController`와 같은 선언. 각 테스트가 한 군데만 비튼다. */
function declarationWith(relationshipsSchema: RelationshipWriteSchema): {
  model: typeof Example;
  serializer: typeof EXAMPLE_SERIALIZER;
  createSchema: typeof ExampleCreate;
  updateSchema: typeof ExampleUpdate;
  relationshipsSchema: RelationshipWriteSchema;
  queryPolicy: typeof EXAMPLE_QUERY_POLICY;
} {
  return {
    model: Example,
    serializer: EXAMPLE_SERIALIZER,
    createSchema: ExampleCreate,
    updateSchema: ExampleUpdate,
    relationshipsSchema,
    queryPolicy: EXAMPLE_QUERY_POLICY,
  };
}

describe('CrudActions 조립 검사', () => {
  it('시리얼라이저가 선언하지 않은 관계를 쓰기 스키마가 들고 있으면 던진다', () => {
    // 라우트는 생기지 않지만 POST 본문의 relationships로는 들어올 수 있다. 그러면
    // 행을 커밋한 뒤 응답을 되읽는 단계에서 터져 성공한 쓰기가 500으로 나간다.
    expect(() =>
      CrudActions(declarationWith({ labels: { cardinality: 'many', type: 'tags', model: Tag } })),
    ).toThrow(TypeError);
  });

  it('cardinality가 두 선언에서 어긋나면 던진다', () => {
    expect(() =>
      CrudActions(declarationWith({ tags: { cardinality: 'one', type: 'tags', model: Tag } })),
    ).toThrow(/cardinality/);
  });

  it('enableUpsert를 켰는데 replaceSchema가 없으면 던진다', () => {
    expect(() =>
      CrudActions({ ...declarationWith(EXAMPLE_RELATIONSHIPS), enableUpsert: true }),
    ).toThrow(TypeError);
  });

  it('선언이 맞으면 클래스를 만든다', () => {
    expect(
      CrudActions({
        ...declarationWith(EXAMPLE_RELATIONSHIPS),
        enableUpsert: true,
        replaceSchema: ExampleReplace,
      }),
    ).toEqual(expect.any(Function));
  });
});
