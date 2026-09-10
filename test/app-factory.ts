import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/config/app.module.js';
import { configureHttp } from '../src/config/http.js';
import { setupOpenApi } from '../src/config/openapi.js';
import { ensureMigrated, requireTestDatabaseUrl } from './db/fixture.js';

/**
 * 테스트 앱이 붙을 곳과 서명할 키를 정한다.
 *
 * `AppModule`이 조립 시점에 `DATABASE_URL`과 `JWT_SECRET_KEY`를 읽으므로 조립 전에
 * 옮겨 담는다. 테스트가 운영 변수 이름을 직접 세팅하면 실수로 개발 DB에 붙을 수
 * 있으므로, 여기 한 곳에서만 변환한다.
 *
 * 비밀 키는 이미 있으면 덮지 않는다 — CI가 다른 값을 주는 것을 막지 않기 위해서다.
 *
 * **`JWT_REFRESH_EXPIRES_SECONDS`는 반대로 무조건 덮어쓴다(`??=`가 아니다).** 이 값은
 * `POST /api/v1/auth/login`이 커밋하는 `refresh_sessions.expires_at`을 정하고,
 * `purgeExpiredRefreshSessions`의 통합 스펙(`purge-refresh-sessions.spec.ts`·
 * `purge-refresh-sessions-contention.spec.ts`)은 그 만료 행을 실제로 지운다. 두 종류의
 * 스펙이 Jest 워커로 병렬 실행되며 같은 테스트 DB를 공유하므로(`test/db/fixture.ts`),
 * `auth-api`/`users-me`/`examples-api`/`examples-put` 네 스위트가 로그인으로 커밋하는
 * 세션은 이 값이 클 때만 "아직 만료되지 않음"이 보장된다 — 근거는
 * `purge-refresh-sessions-contention.spec.ts` 상단 주석. `JWT_SECRET_KEY`와 달리
 * 앰비언트 셸 값을 존중하면 안 되는 이유가 바로 이것이다: `JWT_SECRET_KEY`는 어떤
 * 값이든 애플리케이션 동작에 안전하지만, 이 값은 **작으면 다른 스위트의 격리를
 * 깨는 안전 조건 자체**라 호출자가 임의로 줄일 수 있는 자리가 아니다(실측:
 * `JWT_REFRESH_EXPIRES_SECONDS=1 ./scripts/check.sh`로 재현). 값은 프로덕션 기본값과
 * 같은 2,592,000초(30일)로 고정한다 — 테스트 실행 시간(수 분)에 비해 압도적으로 크다.
 */
function useTestEnvironment(): void {
  process.env.DATABASE_URL = requireTestDatabaseUrl();
  process.env.JWT_SECRET_KEY ??= 'test-only-jwt-secret-key-32-bytes-minimum';
  process.env.JWT_REFRESH_EXPIRES_SECONDS = '2592000';
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
 *
 * 조립 안에서만 `NestExpressApplication`으로 다룬다. `configureHttp`가 Express
 * 고유의 설정(본문 파서, 질의 파서)을 만지므로 그 타입이 필요하지만, 그것은 조립
 * 지점의 사정이지 호출하는 쪽이 알아야 할 것이 아니다.
 *
 * `beforeInit`은 `app.init()` **전에** Express 인스턴스를 만질 유일한 자리다. Nest는
 * 라우트를 모두 붙인 뒤 catch-all not-found 핸들러를 등록하므로(`routes-resolver.ts`의
 * `registerNotFoundHandler`), `init()` 뒤에 얹은 라우트는 그 핸들러에 가려 404가 된다.
 * 미들웨어 계층 자체를 실제 요청으로 확인하려면 이 자리가 필요하다
 * (`test/config/http.spec.ts`가 본문 파서에 쓴다). 애플리케이션 라우트를 여기서
 * 늘리지 않는다 — 라우트의 등록 지점은 `RoutesModule` 하나다.
 */
export async function createTestApp(
  beforeInit?: (app: NestExpressApplication) => void,
): Promise<INestApplication<Server>> {
  useTestEnvironment();
  // 조립보다 먼저 스키마를 head까지 올린다. 애플리케이션의 `DataSource`는 운영과 같이
  // `migrationsRun: false`이므로, 이 한 줄이 없으면 이 스위트는 같은 실행의 다른
  // 워커가 마이그레이션을 끝내 주기를 기대하게 된다 — Jest가 파일을 병렬로 돌리는 한
  // 아무것도 보장되지 않는 기대다. 자세한 근거는 `ensureMigrated`의 문서 주석 참고.
  await ensureMigrated();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttp(app);
  setupOpenApi(app);
  beforeInit?.(app);
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
