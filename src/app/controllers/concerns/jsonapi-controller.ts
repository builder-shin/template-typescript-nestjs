import { PATH_METADATA } from '@nestjs/common/constants.js';

/**
 * 컨트롤러 경로와 시리얼라이저의 링크 기준이 어긋나지 않게 한다.
 *
 * 스펙 6.1: `self` 링크와 `POST`·`PUT`의 `Location`은 `serializer.resourcePath`에서
 * 나오고, 실제 라우트는 `@Controller` 경로에서 나온다. 두 값이 갈리면 잘못된 링크가
 * **조용히** 나간다 — 참조 구현이 감지하지 못하던 실패이고, 이 템플릿이 의도적으로
 * 하나 줄이기로 한 것이다.
 *
 * 검사는 팩토리가 아니라 베이스 생성자에서 돈다. 팩토리는 베이스를 만드는 시점에
 * 도는데 `@Controller`는 그 뒤에 서브클래스에 붙으므로, 팩토리 안에서는 비교할
 * 경로가 아직 없다. 생성자로 옮기면 Nest가 컨트롤러를 만드는 부트스트랩에서 터진다.
 */

/** `@Controller` 경로를 `/`로 시작하고 끝나지 않는 형태로 맞춘다. */
export function normalizeControllerPath(path: unknown): string {
  let raw: unknown = path;
  if (Array.isArray(path)) {
    // `Array.isArray`가 좁혀 주는 타입은 `any[]`다. `unknown[]`으로 받아 `any`가
    // 더 번지지 않게 막는다.
    const entries: unknown[] = path;
    raw = entries[0];
  }
  if (typeof raw !== 'string' || raw === '' || raw === '/') {
    return '/';
  }
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.length > 1 && withLeading.endsWith('/')
    ? withLeading.slice(0, -1)
    : withLeading;
}

/** 컨트롤러 경로와 `resourcePath`가 문자열까지 같은지 확인한다. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- Nest 메타데이터의 target 타입이 Function이다
export function assertResourcePath(controller: Function, resourcePath: string | undefined): void {
  if (resourcePath === undefined) {
    throw new TypeError(
      `${controller.name}이(가) 쓰는 시리얼라이저에 resourcePath가 없다. 라우트를 가진 자원은 링크 기준을 선언해야 한다`,
    );
  }
  const declared = normalizeControllerPath(Reflect.getMetadata(PATH_METADATA, controller));
  const expected = normalizeControllerPath(resourcePath);
  if (declared !== expected) {
    throw new TypeError(
      `${controller.name}의 @Controller 경로(${declared})와 시리얼라이저의 resourcePath(${expected})가 다르다`,
    );
  }
}
