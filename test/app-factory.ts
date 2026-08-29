import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/config/app.module.js';
import { setupOpenApi } from '../src/config/openapi.js';
import { requireTestDatabaseUrl } from './db/fixture.js';

/**
 * 테스트 앱은 `TEST_DATABASE_URL`이 가리키는 DB에 붙는다.
 *
 * `AppModule`이 `DATABASE_URL`을 읽으므로 조립 전에 옮겨 담는다. 테스트가 운영 변수
 * 이름을 직접 세팅하면 실수로 개발 DB에 붙을 수 있으므로, 여기 한 곳에서만 변환한다.
 */
function useTestDatabase(): void {
  process.env.DATABASE_URL = requireTestDatabaseUrl();
}

/**
 * 애플리케이션 테스트의 유일한 조립 지점.
 *
 * 테스트가 `Test.createTestingModule`을 직접 호출하지 않는다. 조립 방식이 갈라지면
 * 프로덕션 팩토리와 테스트 팩토리가 서로 다른 앱을 검증하게 된다.
 *
 * `INestApplication`의 `TServer` 기본값은 `any`라서, 이 값을 좁히지 않으면
 * `getHttpServer()`가 `any`를 흘려 호출하는 쪽마다 `strictTypeChecked`의
 * `no-unsafe-argument`를 피하려 캐스트를 반복해야 한다. 서버 타입을 아는 것은
 * 조립 지점의 책임이므로 여기서 `Server`로 고정해 돌려준다.
 */
export async function createTestApp(): Promise<INestApplication<Server>> {
  useTestDatabase();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<Server>>();
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
  return path === '/api/schema' || path.startsWith('/api-docs');
}

/**
 * 애플리케이션이 실제로 노출하는 라우트 집합을 `"METHOD /path"` 문자열로 돌려준다.
 *
 * 라우트가 조용히 늘거나 사라지는 것을 잡기 위한 것이므로 정렬된 배열로 고정 비교한다.
 * OpenAPI 문서 경로는 제외한다. 이 템플릿은 모든 애플리케이션 라우트를 `/api/v1`과
 * `/health` 아래에만 두는 것을 설계 계약으로 삼으므로, 이 제외가 실제 라우트를
 * 가리지 않는다.
 */
export function registeredRoutes(app: INestApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as ExpressInstance;
  const router = instance.router;
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
