import {
  collectionDocument,
  singleDocument,
} from '../../src/app/controllers/concerns/documents.js';
import type { ResourceObject } from '../../src/app/serializers/serializer.js';

const RESOURCE: ResourceObject = {
  type: 'examples',
  id: 'e1',
  attributes: { title: '제목' },
  relationships: {},
  links: { self: '/api/v1/examples/e1' },
};

const LINKS = { self: '/api/v1/examples?page[number]=1&page[size]=25' };

describe('singleDocument', () => {
  it('data를 담는다', () => {
    expect(singleDocument(RESOURCE, [])).toEqual({ data: RESOURCE });
  });

  it('included가 비면 멤버를 생략한다', () => {
    // 빈 배열을 내면 "포함을 요청했는데 아무것도 없다"와 "포함을 요청하지 않았다"가
    // 같은 모양이 된다.
    expect('included' in singleDocument(RESOURCE, [])).toBe(false);
  });

  it('included가 있으면 담는다', () => {
    const document = singleDocument(RESOURCE, [RESOURCE]);
    expect(document.included).toHaveLength(1);
  });
});

describe('collectionDocument', () => {
  it('data와 links를 담는다', () => {
    const document = collectionDocument([RESOURCE], [], LINKS, undefined);
    expect(document.data).toHaveLength(1);
    expect(document.links).toBe(LINKS);
  });

  it('빈 컬렉션도 data가 배열이다', () => {
    // JSON:API는 빈 컬렉션을 `null`이 아니라 `[]`로 요구한다.
    expect(collectionDocument([], [], LINKS, undefined).data).toEqual([]);
  });

  it('총 개수를 모르면 meta를 생략한다', () => {
    expect('meta' in collectionDocument([RESOURCE], [], LINKS, undefined)).toBe(false);
  });

  it('총 개수를 알면 meta.totalCount로 담는다', () => {
    expect(collectionDocument([RESOURCE], [], LINKS, 42).meta).toEqual({ totalCount: 42 });
  });

  it('총 개수가 0이어도 담는다', () => {
    // `0`을 falsy로 흘리면 "0건"이 "모른다"로 바뀐다.
    expect(collectionDocument([], [], LINKS, 0).meta).toEqual({ totalCount: 0 });
  });
});
