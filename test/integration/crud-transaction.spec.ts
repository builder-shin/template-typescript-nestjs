import { ConsoleLogger, Controller, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { DataSource } from 'typeorm';
import { CrudActions } from '../../src/app/controllers/concerns/crud-actions.js';
import { JsonApiExceptionFilter } from '../../src/app/jsonapi/exception-filter.js';
import { Example } from '../../src/app/models/example.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';
import {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleReplace,
  ExampleUpdate,
} from '../../src/app/schemas/example.schemas.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
import type { ResourceSerializer } from '../../src/app/serializers/serializer.js';
import { buildDataSourceOptions } from '../../src/config/database.js';
import { configureHttp } from '../../src/config/http.js';
import { loadDatabaseSettings } from '../../src/config/settings.js';
import { createTestDataSource } from '../db/fixture.js';

/**
 * 트랜잭션 경계를 실제 DB로 증명한다.
 *
 * `examples-api.spec.ts`의 "관계 대상을 못 찾으면 자원도 만들지 않는다"는 이것을 증명하지
 * **못한다**. `create()`에서 관계 해석은 `save()` **이전에** 끝나므로, 트랜잭션 래퍼를
 * 통째로 지워도 그 테스트는 통과한다 — 실패하면 `save()`가 아예 불리지 않기 때문이다.
 * 저장 **뒤에** 터지는 경로만이 롤백을 관찰할 수 있고, `crud-base.ts`의 `afterSave`
 * 주석("여기서 던지면 저장도 함께 롤백된다")이 바로 그 계약을 문서로 약속한다.
 *
 * 그래서 `afterSave`가 언제나 던지는 프로브 컨트롤러를 만든다. `AppModule`은 진짜
 * `ExamplesController`를 등록하므로 쓸 수 없다 — 같은 경로에 훅 없는 컨트롤러가 함께
 * 붙는다. 조립은 `test/controllers/route-registrar.spec.ts`의 프로브 앱과 같은 모양이고,
 * 실제 DB와 전역 예외 필터만 더한 것이다.
 *
 * `replace()`(`PUT`)도 `create`/`update`와 같은 `beforeSave`/`afterSave`를 부르지만
 * 그 사실을 실제로 실행해 보는 테스트가 저장소 어디에도 없었다 — `examples-put.spec.ts`의
 * "없는 관계 대상을 가리키면 자원도 남지 않는다"는 관계 해석이 `beforeSave`보다 먼저
 * 실패하는 경로라 훅이 아예 불리지 않는다(위의 "관계 대상을 못 찾으면"과 같은 이유로
 * 롤백 자체를 증명하지 못한다). 그래서 이 프로브에도 `enableUpsert`를 켠다 — `PUT`
 * 라우트가 생겨야 `upsertRow`가 행을 이미 만든 **뒤에** `afterSave`가 던지는 경로를
 * 실제로 탈 수 있다.
 */

const VENDOR = 'application/vnd.api+json';

/** 훅이 던지는 메시지. 응답에 새어 나오지 않는지 아래 테스트가 이 문자열을 찾는다. */
const HOOK_FAILURE = '훅이 터졌다';

/** 이 스펙이 만들려 시도하는 유일한 제목. 정리 범위를 이 값으로 좁힌다. */
const PROBE_TITLE = '롤백될 것';

/**
 * `PUT` 프로브가 쓰는 고정 id.
 *
 * `upsert`는 경로에 id가 필요해 `POST` 프로브처럼 서버가 생성하게 둘 수 없다. 아래
 * 정리는 여전히 `PROBE_TITLE`로 범위를 좁히므로(자원 id가 아니라 제목으로 지운다)
 * 이 id 자체를 별도로 정리할 필요는 없다 — 롤백이 제대로 되면 애초에 남는 행이 없다.
 */
const PUT_PROBE_ID = '0195c1a0-0000-7000-8000-00000000f001';

/** 직렬화 실패 프로브가 쓰는 고정 id. 이유는 `PUT_PROBE_ID`와 같다. */
const SERIALIZE_PROBE_ID = '0195c1a0-0000-7000-8000-00000000f002';

/**
 * `ExamplesController`와 같은 선언에 `afterSave`만 더한다.
 *
 * 나머지를 실제 선언과 똑같이 두어야 이 테스트가 증명하는 것이 프로브 전용 경로가 아니라
 * 운영 컨트롤러가 지나는 그 경로가 된다.
 */
const ProbeHost = CrudActions({
  model: Example,
  serializer: EXAMPLE_SERIALIZER,
  createSchema: ExampleCreate,
  updateSchema: ExampleUpdate,
  relationshipsSchema: EXAMPLE_RELATIONSHIPS,
  queryPolicy: EXAMPLE_QUERY_POLICY,
  replaceSchema: ExampleReplace,
  enableUpsert: true,
  afterSave: (): void => {
    throw new Error(HOOK_FAILURE);
  },
});

// 경로는 `EXAMPLE_SERIALIZER.resourcePath`와 문자열까지 같아야 한다 —
// `assertResourcePath`가 부트스트랩에서 검사한다.
@Controller('api/v1/examples')
class ExamplesProbeController extends ProbeHost {}

/**
 * `title`을 읽을 때 언제나 던지는 시리얼라이저. `serializeResource`(응답 조립 단계)
 * 실패를 재현하는 유일한 목적이라 다른 attribute·관계는 선언하지 않는다.
 */
const SERIALIZATION_FAILURE = '직렬화가 터졌다';

const throwingSerializer: ResourceSerializer<Example> = {
  type: 'examples',
  resourcePath: '/api/v1/examples-serialize-probe',
  attributes: {
    title: (): string => {
      throw new Error(SERIALIZATION_FAILURE);
    },
  },
  relationships: {},
};

/**
 * `replace()`가 재조회+직렬화를 **커밋 전**, 같은 트랜잭션 안에서 하기로 한 결정을
 * 붙잡아 두는 프로브(`crud-actions.ts`의 `replace()` 안 "재조회도 이 트랜잭션 안에서
 * 한다" 주석 참고). `afterSave` 실패와는 터지는 자리가 다르다 — 이쪽은 저장이 끝나고
 * 응답을 조립하는 단계에서 터진다. 그래서 위 훅 실패 롤백 테스트가 이 경로를 대신하지
 * 못한다.
 */
const SerializeFailureHost = CrudActions({
  model: Example,
  serializer: throwingSerializer,
  createSchema: ExampleCreate,
  updateSchema: ExampleUpdate,
  relationshipsSchema: {},
  queryPolicy: EXAMPLE_QUERY_POLICY,
  replaceSchema: ExampleReplace,
  enableUpsert: true,
});

@Controller('api/v1/examples-serialize-probe')
class SerializeFailureProbeController extends SerializeFailureHost {}

/** `Logger.overrideLogger`로 가로챈 `error` 호출 한 건. */
interface LoggedError {
  readonly message: unknown;
  readonly params: readonly unknown[];
}

describe('CrudActions 트랜잭션 경계', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  const logged: LoggedError[] = [];

  // `status`·`score`는 생성·교체에서 필수다(Task 2). 이 프로브들이 증명하려는 것은
  // 훅/직렬화 실패의 트랜잭션 경계이지 검증이 아니므로, 둘 다 통과하는 값을 채워
  // 요청이 422가 아니라 훅까지 도달하게 한다.
  function createProbe(): Promise<Response> {
    return request(app.getHttpServer())
      .post('/api/v1/examples')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            attributes: { title: PROBE_TITLE, status: 'draft', score: 0 },
          },
        }),
      );
  }

  /** 없는 id로 `PUT` — upsert가 반드시 생성 분기(행을 새로 만드는 쪽)를 타게 한다. */
  function putProbe(): Promise<Response> {
    return request(app.getHttpServer())
      .put(`/api/v1/examples/${PUT_PROBE_ID}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            id: PUT_PROBE_ID,
            attributes: { title: PROBE_TITLE, status: 'draft', score: 0 },
          },
        }),
      );
  }

  /** 없는 id로 `PUT` — `throwingSerializer`가 붙은 경로라 응답 조립 단계에서 던진다. */
  function serializeFailureProbe(): Promise<Response> {
    return request(app.getHttpServer())
      .put(`/api/v1/examples-serialize-probe/${SERIALIZE_PROBE_ID}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(
        JSON.stringify({
          data: {
            type: 'examples',
            id: SERIALIZE_PROBE_ID,
            attributes: { title: PROBE_TITLE, status: 'draft', score: 0 },
          },
        }),
      );
  }

  beforeAll(async () => {
    // 앱의 `DataSource`는 `migrationsRun: false`라 스키마를 만들지 않는다. 이 스펙이
    // 어떤 순서로 돌든 테이블이 있어야 하므로 fixture로 마이그레이션을 보장하고,
    // 그 `DataSource`를 이 파일의 원시 SQL에도 그대로 쓴다.
    dataSource = await createTestDataSource();
    process.env.DATABASE_URL = requireDatabaseUrl(dataSource);

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: () => buildDataSourceOptions(loadDatabaseSettings()),
        }),
      ],
      controllers: [ExamplesProbeController, SerializeFailureProbeController],
      // 전역 예외 필터가 없으면 500이 Nest 기본 형식으로 나가 오류 문서를 볼 수 없다.
      providers: [{ provide: APP_FILTER, useClass: JsonApiExceptionFilter }],
    })
      // 훅이 던지는 것은 `JsonApiError`가 아니라 알 수 없는 오류라 예외 필터가 스택
      // 트레이스를 기록한다. 가로채지 않으면 테스트 출력이 그것으로 덮인다. 가로채는
      // 김에 무엇이 실제로 기록되는지도 아래에서 단언한다.
      //
      // `Logger.overrideLogger`를 직접 부르지 않는다 — `compile()`이 그 안에서
      // `Logger.overrideLogger(this.testingLogger ?? new TestingLogger())`를 실행해
      // 미리 세팅한 값을 덮어쓴다(실측). `setLogger`가 그 자리에 우리 것을 넣는 통로다.
      .setLogger({
        log: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
        verbose: () => undefined,
        error: (message: unknown, ...params: unknown[]) => {
          logged.push({ message, params });
        },
      })
      .compile();

    const created = moduleRef.createNestApplication<NestExpressApplication>();
    configureHttp(created);
    await created.init();
    // 루프백에 미리 연다 — 이유는 `test/app-factory.ts`의 같은 줄 주석.
    await created.listen(0, '127.0.0.1');
    app = created;
  });

  beforeEach(() => {
    logged.length = 0;
  });

  afterEach(async () => {
    // 롤백이 동작하면 지울 것이 없다. 그래도 지우는 이유는 이 정리가 회귀의 안전망이기
    // 때문이다 — 롤백이 깨지면 행이 커밋되어 남고, 같은 DB를 쓰는 다른 워커로 샌다.
    //
    // 제목으로 범위를 좁힌다. 조건 없는 `DELETE FROM examples`는 같은 순간 다른 워커가
    // 커밋해 둔 행까지 지워, 방금 없앤 TRUNCATE와 같은 종류의 사고를 다시 만든다.
    await dataSource.query('DELETE FROM examples WHERE title = $1', [PROBE_TITLE]);
  });

  afterAll(async () => {
    await app.close();
    await dataSource.destroy();
    // 정적 상태이므로 반드시 되돌린다.
    Logger.overrideLogger(new ConsoleLogger());
  });

  it('afterSave가 던지면 저장도 함께 롤백된다', async () => {
    // 이것만이 트랜잭션 경계를 증명한다. 관계 대상이 없어 실패하는 경로는 save() 전에
    // 걸리므로 트랜잭션이 없어도 0행이다 — 저장 **뒤에** 터져야 롤백이 관찰된다.
    const response = await createProbe();

    expect(response.status).toBe(500);

    const rows = await dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*) AS count FROM examples WHERE title = $1',
      [PROBE_TITLE],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('PUT의 afterSave가 던지면 upsert가 만든 행도 함께 롤백된다', async () => {
    // 위 POST 테스트와 증명하는 지점이 다르다. `examples-put.spec.ts`의 "없는 관계
    // 대상을 가리키면 자원도 남지 않는다"는 관계 해석이 beforeSave보다 먼저 실패하는
    // 경로라 훅이 아예 불리지 않는다 — 트랜잭션이 없어도 0행이라 롤백을 증명하지 못한다
    // (위 파일 머리 주석과 같은 이유). 이 테스트는 그 반대다: upsertRow의
    // `INSERT ... ON CONFLICT`가 행을 이미 만든 **뒤에** afterSave가 던진다. 롤백이
    // 깨지면 upsert가 만든 행이 그대로 남는다.
    const response = await putProbe();

    expect(response.status).toBe(500);

    const rows = await dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*) AS count FROM examples WHERE id = $1',
      [PUT_PROBE_ID],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('PUT에서 재조회·직렬화가 던지면 upsert가 만든 행도 함께 롤백된다', async () => {
    // `create()`/`update()`는 커밋 **뒤에** 재조회하므로 이 시점에 터지면 이미 커밋된
    // 행이 남는다 — Phase 4의 기존 규약이고 여기서 바꾸는 것이 아니다(그 동작을
    // 계약으로 단언하지 않는다. 바람직해서가 아니라 아직 그런 것뿐이다). `PUT`만
    // 다르다는 것을, 즉 재조회를 트랜잭션 밖으로 옮기지 않기로 한 결정이 실제로
    // 지켜지고 있다는 것을 이 테스트가 고정한다.
    const response = await serializeFailureProbe();

    expect(response.status).toBe(500);

    const rows = await dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*) AS count FROM examples WHERE id = $1',
      [SERIALIZE_PROBE_ID],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('훅이 던진 원인은 응답에 실리지 않는다', async () => {
    // 예외 필터의 계약이 이 경로에서도 지켜지는지 함께 본다.
    const response = await createProbe();

    expect(JSON.stringify(response.body)).not.toContain(HOOK_FAILURE);
    expect((response.body as { errors: { code: string }[] }).errors[0]?.code).toBe(
      'INTERNAL_SERVER_ERROR',
    );
    // 응답에 없다는 것만 보면 원인이 어디에도 남지 않아도 통과한다. 서버 로그에는
    // 남아야 한다 — 그래야 이 500을 나중에 진단할 수 있다.
    expect(JSON.stringify(logged)).toContain(HOOK_FAILURE);
  });
});

/**
 * fixture가 연결한 URL을 다시 꺼낸다.
 *
 * `loadDatabaseSettings()`는 `DATABASE_URL`을 읽는데, 테스트는 `TEST_DATABASE_URL`을
 * 쓴다. 앱과 fixture가 반드시 같은 DB를 보게 하려고 fixture가 실제로 연 옵션에서
 * 되읽는다 — 두 곳이 각자 환경 변수를 읽으면 갈라질 수 있다.
 */
function requireDatabaseUrl(dataSource: DataSource): string {
  const options = dataSource.options;
  if (options.type !== 'postgres' || typeof options.url !== 'string') {
    throw new Error('테스트 DataSource가 postgres URL로 열려 있지 않다');
  }
  return options.url;
}
