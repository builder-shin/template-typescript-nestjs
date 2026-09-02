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
  ExampleUpdate,
} from '../../src/app/schemas/example.schemas.js';
import { EXAMPLE_SERIALIZER } from '../../src/app/serializers/example.serializer.js';
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
 */

const VENDOR = 'application/vnd.api+json';

/** 훅이 던지는 메시지. 응답에 새어 나오지 않는지 아래 테스트가 이 문자열을 찾는다. */
const HOOK_FAILURE = '훅이 터졌다';

/** 이 스펙이 만들려 시도하는 유일한 제목. 정리 범위를 이 값으로 좁힌다. */
const PROBE_TITLE = '롤백될 것';

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
  afterSave: (): void => {
    throw new Error(HOOK_FAILURE);
  },
});

// 경로는 `EXAMPLE_SERIALIZER.resourcePath`와 문자열까지 같아야 한다 —
// `assertResourcePath`가 부트스트랩에서 검사한다.
@Controller('api/v1/examples')
class ExamplesProbeController extends ProbeHost {}

/** `Logger.overrideLogger`로 가로챈 `error` 호출 한 건. */
interface LoggedError {
  readonly message: unknown;
  readonly params: readonly unknown[];
}

describe('CrudActions 트랜잭션 경계', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  const logged: LoggedError[] = [];

  function createProbe(): Promise<Response> {
    return request(app.getHttpServer())
      .post('/api/v1/examples')
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(JSON.stringify({ data: { type: 'examples', attributes: { title: PROBE_TITLE } } }));
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
      controllers: [ExamplesProbeController],
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
