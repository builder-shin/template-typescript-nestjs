import { JSONAPI_MEDIA_TYPE } from '../../src/app/jsonapi/media-type.js';

describe('JSONAPI_MEDIA_TYPE', () => {
  it('JSON:API 1.1 vendor 미디어 타입이다', () => {
    expect(JSONAPI_MEDIA_TYPE).toBe('application/vnd.api+json');
  });
});
