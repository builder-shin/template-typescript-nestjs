import { collectIncluded, serializeResource } from '../../src/app/serializers/serializer.js';
import type { ErasedSerializer, ResourceSerializer } from '../../src/app/serializers/serializer.js';

interface Author {
  id: string;
  name: string;
}

interface Post {
  id: string;
  title: string;
  createdAt: Date;
  author?: Author | null;
  reviewers?: Author[];
}

const AUTHOR_SERIALIZER: ResourceSerializer<Author> = {
  type: 'authors',
  resourcePath: '/api/v1/authors',
  attributes: { name: (author) => author.name },
  relationships: {},
};

const ERASED_AUTHOR: ErasedSerializer = {
  type: AUTHOR_SERIALIZER.type,
  resourcePath: AUTHOR_SERIALIZER.resourcePath,
  serializeUnknown(entity: unknown) {
    if (typeof entity !== 'object' || entity === null || !('name' in entity)) {
      throw new TypeError('author가 아니다');
    }
    const name = entity.name;
    const id = 'id' in entity ? entity.id : undefined;
    if (typeof name !== 'string' || typeof id !== 'string') {
      throw new TypeError('author가 아니다');
    }
    return serializeResource(AUTHOR_SERIALIZER, { id, name });
  },
};

const POST_SERIALIZER: ResourceSerializer<Post> = {
  type: 'posts',
  resourcePath: '/api/v1/posts',
  attributes: {
    title: (post) => post.title,
    createdAt: (post) => post.createdAt.toISOString(),
  },
  relationships: {
    author: {
      cardinality: 'one',
      eagerLoad: 'author',
      read: (post) => post.author,
      target: () => ERASED_AUTHOR,
    },
    reviewers: {
      cardinality: 'many',
      eagerLoad: 'reviewers',
      read: (post) => post.reviewers,
      target: () => ERASED_AUTHOR,
    },
  },
};

const CREATED_AT = new Date('2026-08-30T00:00:00.000Z');

function post(overrides: Partial<Post> = {}): Post {
  return { id: 'p1', title: '제목', createdAt: CREATED_AT, ...overrides };
}

describe('serializeResource', () => {
  it('type과 id를 담는다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    expect(object.type).toBe('posts');
    expect(object.id).toBe('p1');
  });

  it('선언한 attribute만 담는다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    expect(Object.keys(object.attributes).sort()).toEqual(['createdAt', 'title']);
  });

  it('attribute 값은 선언한 함수가 만든다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    expect(object.attributes.title).toBe('제목');
    expect(object.attributes.createdAt).toBe('2026-08-30T00:00:00.000Z');
  });

  it('self 링크는 resourcePath와 id로 만든다', () => {
    expect(serializeResource(POST_SERIALIZER, post()).links?.self).toBe('/api/v1/posts/p1');
  });

  it('관계마다 self와 related 링크를 낸다', () => {
    const object = serializeResource(POST_SERIALIZER, post());
    const author = object.relationships.author;
    if (author === undefined) {
      throw new Error('author 관계가 없다');
    }
    expect(author.links).toEqual({
      self: '/api/v1/posts/p1/relationships/author',
      related: '/api/v1/posts/p1/author',
    });
  });

  it('resourcePath가 없으면 링크를 내지 않는다', () => {
    // 스펙 16장의 공개 API 표면에 라우트가 없는 자원(예: include로만 노출되는
    // Category)은 self 링크를 가질 수 없다. 그런 자원에 링크를 지어내면 클라이언트가
    // 404를 따라가게 된다.
    const pathless: ResourceSerializer<Author> = {
      type: 'authors',
      attributes: { name: (author) => author.name },
      relationships: {},
    };
    const object = serializeResource(pathless, { id: 'a1', name: '글쓴이' });
    expect(object.links).toBeUndefined();
    expect(object.id).toBe('a1');
    expect(object.attributes.name).toBe('글쓴이');
  });

  it('로드되지 않은 관계는 data를 생략한다', () => {
    // 로드하지 않은 것과 "없음"은 다르다. undefined는 모른다는 뜻이므로 linkage를
    // 지어내지 않는다 — 지어내면 클라이언트가 관계가 비었다고 오해한다.
    const object = serializeResource(POST_SERIALIZER, post());
    const author = object.relationships.author;
    if (author === undefined) {
      throw new Error('author 관계가 없다');
    }
    expect('data' in author).toBe(false);
  });

  it('to-one 관계가 null이면 data도 null이다', () => {
    const object = serializeResource(POST_SERIALIZER, post({ author: null }));
    expect(object.relationships.author?.data).toBeNull();
  });

  it('to-one 관계의 linkage를 담는다', () => {
    const object = serializeResource(
      POST_SERIALIZER,
      post({ author: { id: 'a1', name: '글쓴이' } }),
    );
    expect(object.relationships.author?.data).toEqual({ type: 'authors', id: 'a1' });
  });

  it('to-many 관계의 linkage를 배열로 담는다', () => {
    const object = serializeResource(
      POST_SERIALIZER,
      post({
        reviewers: [
          { id: 'a1', name: 'ㄱ' },
          { id: 'a2', name: 'ㄴ' },
        ],
      }),
    );
    expect(object.relationships.reviewers?.data).toEqual([
      { type: 'authors', id: 'a1' },
      { type: 'authors', id: 'a2' },
    ]);
  });

  it('빈 to-many 관계는 빈 배열이다', () => {
    const object = serializeResource(POST_SERIALIZER, post({ reviewers: [] }));
    expect(object.relationships.reviewers?.data).toEqual([]);
  });
});

describe('collectIncluded', () => {
  it('to-one 관계 대상을 대상 시리얼라이저로 직렬화한다', () => {
    const included = collectIncluded(
      POST_SERIALIZER,
      [post({ author: { id: 'a1', name: '글쓴이' } })],
      ['author'],
    );
    expect(included).toHaveLength(1);
    expect(included[0]?.type).toBe('authors');
    expect(included[0]?.attributes.name).toBe('글쓴이');
  });

  it('같은 자원을 두 번 담지 않는다', () => {
    // 여러 Post가 같은 저자를 가리키면 included에 한 번만 나와야 한다.
    const shared = { id: 'a1', name: '글쓴이' };
    const included = collectIncluded(
      POST_SERIALIZER,
      [post({ id: 'p1', author: shared }), post({ id: 'p2', author: shared })],
      ['author'],
    );
    expect(included).toHaveLength(1);
  });

  it('로드되지 않았거나 비어 있는 관계는 건너뛴다', () => {
    expect(collectIncluded(POST_SERIALIZER, [post(), post({ author: null })], ['author'])).toEqual(
      [],
    );
  });

  it('to-many 관계의 모든 대상을 담는다', () => {
    const included = collectIncluded(
      POST_SERIALIZER,
      [
        post({
          reviewers: [
            { id: 'a1', name: 'ㄱ' },
            { id: 'a2', name: 'ㄴ' },
          ],
        }),
      ],
      ['reviewers'],
    );
    expect(included.map((object) => object.id).sort()).toEqual(['a1', 'a2']);
  });

  it('여러 include 경로를 함께 처리한다', () => {
    const included = collectIncluded(
      POST_SERIALIZER,
      [post({ author: { id: 'a1', name: 'ㄱ' }, reviewers: [{ id: 'a2', name: 'ㄴ' }] })],
      ['author', 'reviewers'],
    );
    expect(included.map((object) => object.id).sort()).toEqual(['a1', 'a2']);
  });

  it('선언되지 않은 관계 경로는 프로그래밍 오류다', () => {
    // 사용자 입력 검증은 include.ts가 이미 끝낸 뒤에 이 함수가 불린다. 여기까지
    // 온 미선언 경로는 호출 측 버그이므로 JsonApiError가 아니라 TypeError를 던진다.
    expect(() => collectIncluded(POST_SERIALIZER, [post()], ['unknown'])).toThrow(TypeError);
  });
});
