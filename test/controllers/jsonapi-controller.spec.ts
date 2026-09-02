import { Controller } from '@nestjs/common';
import {
  assertResourcePath,
  normalizeControllerPath,
} from '../../src/app/controllers/concerns/jsonapi-controller.js';

describe('normalizeControllerPath', () => {
  it('앞에 슬래시를 붙이고 끝 슬래시를 뗀다', () => {
    expect(normalizeControllerPath('api/v1/examples')).toBe('/api/v1/examples');
    expect(normalizeControllerPath('/api/v1/examples/')).toBe('/api/v1/examples');
  });

  it('배열로 온 경로는 첫 값을 쓴다', () => {
    // `@Controller(['a', 'b'])`가 가능하다. 첫 경로가 self 링크의 기준이 된다.
    expect(normalizeControllerPath(['api/v1/examples'])).toBe('/api/v1/examples');
  });

  it('경로가 없으면 루트다', () => {
    expect(normalizeControllerPath(undefined)).toBe('/');
    expect(normalizeControllerPath('')).toBe('/');
  });

  it('루트 경로를 그대로 돌려준다', () => {
    // 스펙 5.1이 루트 마운트 컨트롤러를 다룬다. `/`가 `//`나 빈 문자열이 되면
    // 그 컨트롤러의 self 링크가 통째로 어긋난다.
    expect(normalizeControllerPath('/')).toBe('/');
  });
});

describe('assertResourcePath', () => {
  it('경로가 같으면 통과한다', () => {
    @Controller('api/v1/examples')
    class Matching {}

    expect(() => {
      assertResourcePath(Matching, '/api/v1/examples');
    }).not.toThrow();
  });

  it('경로가 어긋나면 던진다', () => {
    // 두 값이 갈리면 self 링크와 Location 헤더가 존재하지 않는 URL을 가리킨다.
    // 첫 요청이 아니라 부트스트랩에서 터져야 한다.
    @Controller('api/v1/samples')
    class Mismatched {}

    expect(() => {
      assertResourcePath(Mismatched, '/api/v1/examples');
    }).toThrow(/api\/v1\/samples/);
  });

  it('시리얼라이저에 resourcePath가 없으면 던진다', () => {
    // 라우트를 가진 자원은 반드시 링크 기준을 선언해야 한다. include 전용
    // 시리얼라이저를 컨트롤러에 붙이는 것은 선언 실수다.
    @Controller('api/v1/examples')
    class Pathless {}

    expect(() => {
      assertResourcePath(Pathless, undefined);
    }).toThrow(TypeError);
  });

  it('끝 슬래시 차이는 문제 삼지 않는다', () => {
    @Controller('api/v1/examples/')
    class Trailing {}

    expect(() => {
      assertResourcePath(Trailing, '/api/v1/examples');
    }).not.toThrow();
  });
});
