import { Controller, Injectable } from '@nestjs/common';
import type { CanActivate, INestApplication, Type } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  RESOURCE_ALIAS,
  registerRoutes,
} from '../../src/app/controllers/concerns/route-registrar.js';
import type { RegisteredRoutes } from '../../src/app/controllers/concerns/route-registrar.js';
import {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleUpdate,
} from '../../src/app/schemas/example.schemas.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
import { Example } from '../../src/app/models/example.entity.js';
import { registeredRoutes } from '../app-factory.js';

/** 라우트 등록만 확인하는 최소 호스트. 액션 본문은 이 태스크의 관심사가 아니다. */
function hostFor(overrides: { enableUpsert?: boolean; writeGuards?: Type<CanActivate>[] } = {}): {
  Host: Type<object>;
  registered: RegisteredRoutes;
} {
  class Host {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    index(): void {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    show(): void {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    create(): void {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    update(): void {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    destroy(): void {}
  }
  const declaration = {
    model: Example,
    serializer: EXAMPLE_SERIALIZER,
    createSchema: ExampleCreate,
    updateSchema: ExampleUpdate,
    relationshipsSchema: EXAMPLE_RELATIONSHIPS,
    queryPolicy: EXAMPLE_QUERY_POLICY,
    ...overrides,
  };
  const registered = registerRoutes(Host, declaration);
  return { Host, registered };
}

describe('RESOURCE_ALIAS', () => {
  it('질의 별칭을 고정한다', () => {
    expect(RESOURCE_ALIAS).toBe('resource');
  });
});

describe('registerRoutes 등록 대상', () => {
  it('시리얼라이저와 관계 스키마의 교집합만 등록한다', () => {
    const { registered } = hostFor();
    expect([...registered.relationshipNames].sort()).toEqual(['category', 'tags']);
  });

  it('관계 스키마에 없는 관계는 등록하지 않는다', () => {
    class Host {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      index(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      show(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      create(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      update(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      destroy(): void {}
    }
    const categoryRule = EXAMPLE_RELATIONSHIPS.category;
    if (categoryRule === undefined) {
      throw new Error('EXAMPLE_RELATIONSHIPS에 category가 없다');
    }
    const registered = registerRoutes(Host, {
      model: Example,
      serializer: EXAMPLE_SERIALIZER,
      createSchema: ExampleCreate,
      updateSchema: ExampleUpdate,
      relationshipsSchema: { category: categoryRule },
      queryPolicy: EXAMPLE_QUERY_POLICY,
    });
    expect(registered.relationshipNames).toEqual(['category']);
  });
});

describe('registerRoutes가 만드는 라우트', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const { Host } = hostFor();

    @Controller('api/v1/examples')
    class ExamplesProbe extends Host {}

    const moduleRef = await Test.createTestingModule({ controllers: [ExamplesProbe] }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('스펙 16장의 라우트를 정확히 만든다', () => {
    expect(registeredRoutes(app)).toEqual([
      'DELETE /api/v1/examples/:id',
      'DELETE /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples',
      'GET /api/v1/examples/:id',
      'GET /api/v1/examples/:id/category',
      'GET /api/v1/examples/:id/relationships/category',
      'GET /api/v1/examples/:id/relationships/tags',
      'GET /api/v1/examples/:id/tags',
      'PATCH /api/v1/examples/:id',
      'PATCH /api/v1/examples/:id/relationships/category',
      'PATCH /api/v1/examples/:id/relationships/tags',
      'POST /api/v1/examples',
      'POST /api/v1/examples/:id/relationships/tags',
    ]);
  });

  it('to-one 관계에는 POST와 DELETE를 만들지 않는다', () => {
    // 스펙 7.3: to-one은 GET/PATCH뿐이다. 목록에 더하고 빼는 개념이 없다.
    const routes = registeredRoutes(app);
    expect(routes).not.toContain('POST /api/v1/examples/:id/relationships/category');
    expect(routes).not.toContain('DELETE /api/v1/examples/:id/relationships/category');
  });

  it('enableUpsert가 아니면 PUT을 만들지 않는다', () => {
    expect(registeredRoutes(app)).not.toContain('PUT /api/v1/examples/:id');
  });
});

describe('writeGuards', () => {
  let guarded: INestApplication<Server>;

  @Injectable()
  class DenyGuard implements CanActivate {
    canActivate(): boolean {
      return false;
    }
  }

  beforeAll(async () => {
    const { Host } = hostFor({ writeGuards: [DenyGuard] });

    @Controller('api/v1/examples')
    class GuardedProbe extends Host {}

    const moduleRef = await Test.createTestingModule({
      controllers: [GuardedProbe],
      providers: [DenyGuard],
    }).compile();
    guarded = moduleRef.createNestApplication<INestApplication<Server>>();
    await guarded.init();
  });

  afterAll(async () => {
    await guarded.close();
  });

  it('쓰기 메서드를 가드가 막는다', async () => {
    await request(guarded.getHttpServer()).post('/api/v1/examples').expect(403);
  });

  it('관계 mutation도 가드가 막는다', async () => {
    // 스펙 16장은 "쓰기와 관계 변경"을 함께 묶는다. 관계 라우트가 가드 목록에
    // 들어가지 않으면 인증을 우회하는 문이 하나 열린 채로 남는다.
    await request(guarded.getHttpServer())
      .patch('/api/v1/examples/e1/relationships/tags')
      .expect(403);
  });

  it('읽기는 막지 않는다', async () => {
    // 읽기가 함께 막히면 공개 조회가 사라진다. 가드가 쓰기에만 붙는지가 계약이다.
    await request(guarded.getHttpServer()).get('/api/v1/examples').expect(200);
  });
});
