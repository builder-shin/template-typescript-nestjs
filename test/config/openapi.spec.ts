import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';

/** 보안 요구 하나. 스킴 이름을 키로, scope 목록을 값으로 가진다(bearer는 항상 빈 배열). */
type SecurityRequirement = Record<string, readonly string[]>;

/** 경로 하나의 operation들. 이 파일이 실제로 쓰는 메서드만 좁혀 받는다. */
interface PathItemObject {
  readonly get?: { readonly security?: readonly SecurityRequirement[] };
  readonly post?: { readonly security?: readonly SecurityRequirement[] };
}

interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, PathItemObject>;
  readonly components?: {
    readonly securitySchemes?: Record<string, { readonly type: string; readonly scheme: string }>;
  };
}

describe('OpenAPI 문서', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** `/api/schema`를 다시 조회해 문서를 돌려준다. 아래 보안 스킴 확인들이 공유한다. */
  async function fetchDocument(): Promise<OpenApiDocument> {
    const response = await request(app.getHttpServer()).get('/api/schema');
    return response.body as OpenApiDocument;
  }

  it('GET /api/schema 가 OpenAPI 문서를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/api/schema');

    expect(response.status).toBe(200);

    const document = response.body as OpenApiDocument;
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.version).toBe('0.1.0');
  });

  it('명시적으로 조립한 라우트만 문서에 나온다', async () => {
    const response = await request(app.getHttpServer()).get('/api/schema');
    const document = response.body as OpenApiDocument;

    // OpenAPI는 경로 파라미터를 `:id`가 아니라 `{id}`로 적는다. 같은 라우트 집합을
    // Express 표기로 고정하는 것은 `routes.module.spec.ts`다.
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/logout',
      '/api/v1/auth/refresh',
      '/api/v1/auth/register',
      '/api/v1/examples',
      '/api/v1/examples/{id}',
      '/api/v1/examples/{id}/category',
      '/api/v1/examples/{id}/relationships/category',
      '/api/v1/examples/{id}/relationships/tags',
      '/api/v1/examples/{id}/tags',
      '/api/v1/users/me',
      '/health/live',
      '/health/ready',
    ]);
  });

  /**
   * 이 네 테스트는 `docker-compose.yml`이 아니라 `route-registrar.ts`/`openapi.ts`가
   * 실제로 붙이는 Bearer 보안 표시를 고정한다. `addBearerAuth()`를 지우거나
   * `guardWrites`의 `ApiBearerAuth()` 줄만 빼도 이 중 하나 이상이 실패해야 한다 —
   * 그렇지 않으면 이 검사가 배선을 붙잡지 못하는 것이다(레드 실측: 이 커밋의 보고서
   * 참고). 스킴 등록(1)과 손으로 데코레이터를 붙인 라우트(2)만 확인하면 `CrudActions`가
   * 동적으로 만드는 라우트 쪽(3)이 빠져도 안 걸리므로, 세 검사를 함께 둔다. 읽기가
   * 문서에서도 공개로 남는지(4)는 반대 방향 실수 — 가드도 문서 표시도 전부에 붙여
   * 버리는 실수 — 를 잡는다.
   */
  describe('보안 스킴', () => {
    it('bearer 보안 스킴을 등록한다', async () => {
      const document = await fetchDocument();
      expect(document.components?.securitySchemes?.bearer).toMatchObject({
        type: 'http',
        scheme: 'bearer',
      });
    });

    it('GET /api/v1/users/me는 인증이 필요하다고 문서화한다', async () => {
      const document = await fetchDocument();
      expect(document.paths['/api/v1/users/me']?.get?.security).toEqual([{ bearer: [] }]);
    });

    it('쓰기 라우트(POST /api/v1/examples)는 인증이 필요하다고 문서화한다', async () => {
      // route-registrar.ts의 guardWrites가 UseGuards와 같은 자리에 붙이는
      // ApiBearerAuth()를 확인한다 — CrudActions가 동적으로 만드는 라우트라 손으로
      // 데코레이터를 적을 자리가 없으므로, 이 라우트가 문서에 나오는지 자체가 그
      // 배선이 실제로 도는지의 유일한 증거다.
      const document = await fetchDocument();
      expect(document.paths['/api/v1/examples']?.post?.security).toEqual([{ bearer: [] }]);
    });

    it('읽기 라우트(GET /api/v1/examples)는 인증이 필요 없다고 문서화한다', async () => {
      // 쓰기 검사와 짝을 이룬다 — writeGuards가 읽기에는 붙지 않는다는 계약을 문서도
      // 그대로 반영하는지 본다. 여기서 security가 실리면 가드를 전부에 붙인 것과 같은
      // 실수를 문서가 그대로 광고하는 것이다.
      const document = await fetchDocument();
      expect(document.paths['/api/v1/examples']?.get?.security).toBeUndefined();
    });
  });
});
