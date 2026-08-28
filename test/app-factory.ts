import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/config/app.module.js';
import { setupOpenApi } from '../src/config/openapi.js';

/**
 * 애플리케이션 테스트의 유일한 조립 지점.
 *
 * 테스트가 `Test.createTestingModule`을 직접 호출하지 않는다. 조립 방식이 갈라지면
 * 프로덕션 팩토리와 테스트 팩토리가 서로 다른 앱을 검증하게 된다.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupOpenApi(app);
  await app.init();
  return app;
}

interface ExpressRoute {
  readonly path: string;
  readonly methods: Record<string, boolean>;
}

interface ExpressLayer {
  readonly route?: ExpressRoute;
}

interface ExpressRouter {
  readonly stack: readonly ExpressLayer[];
}

interface ExpressInstance {
  readonly router?: ExpressRouter;
  readonly _router?: ExpressRouter;
}

/**
 * OpenAPI 문서화가 등록하는 경로들. 애플리케이션 라우트가 아니라 문서 UI의 정적 자산이다.
 *
 * `SwaggerModule.setup`은 라우터 스택에 8개 레이어를 남긴다(`/api-docs`, `/api-docs-yaml`,
 * `/api-docs/LICENSE`, `/api-docs/swagger-ui-init.js` 등). 이 목록을 라우트 계약에 넣으면
 * `@nestjs/swagger`의 내부 자산 배치가 바뀔 때마다 테스트가 깨진다. `/api/schema`의 실제
 * 노출은 `test/config/openapi.spec.ts`가 HTTP 요청으로 따로 확인한다.
 */
function isDocumentationPath(path: string): boolean {
  return path === '/api/schema' || path === '/api-docs-yaml' || path.startsWith('/api-docs');
}

/**
 * 애플리케이션이 실제로 노출하는 라우트 집합을 `"METHOD /path"` 문자열로 돌려준다.
 *
 * 라우트가 조용히 늘거나 사라지는 것을 잡기 위한 것이므로 정렬된 배열로 고정 비교한다.
 * OpenAPI 문서 경로는 제외한다. 이 템플릿은 모든 애플리케이션 라우트를 `/api/v1`과
 * `/health` 아래에만 두므로 이 제외가 실제 라우트를 가리지 않는다.
 */
export function registeredRoutes(app: INestApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as ExpressInstance;
  const router = instance.router ?? instance._router;
  const routes: string[] = [];

  for (const layer of router?.stack ?? []) {
    if (layer.route === undefined || isDocumentationPath(layer.route.path)) {
      continue;
    }
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled) {
        routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
  }

  return routes.sort();
}
