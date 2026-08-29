import { ConsoleLogger, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './app-factory.js';
import { buildDataSourceOptions } from '../src/config/database.js';
import { ERROR_CATALOG, JsonApiError } from '../src/app/jsonapi/errors.js';
import { HealthController } from '../src/app/controllers/health.controller.js';
import type { LiveStatus, ReadyStatus } from '../src/app/controllers/health.controller.js';

// supertest는 `response.body`를 `any`로 노출한다. `strictTypeChecked`의
// `no-unsafe-argument`에 걸리므로 단언 전에 명시적으로 좁힌다. 컨트롤러가 내보내는
// `LiveStatus`/`ReadyStatus`를 그대로 써서 응답 모양이 컨트롤러와 갈라지지 않게 한다.

/**
 * `noUncheckedIndexedAccess` 아래에서 `arr[0]`은 `T | undefined`다. 캐스트로 지우는 대신
 * 실제 분기로 좁힌다 — 이 헬퍼가 던지는 경우는 오류 문서가 비어 있다는 뜻이므로
 * 그 자체로 테스트 실패 사유다.
 */
function firstOf<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

describe('HealthController', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live 는 200과 ok 를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body as LiveStatus).toEqual({ status: 'ok' });
  });

  it('GET /health/ready 는 200과 ok 를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body as ReadyStatus).toEqual({ status: 'ok', database: 'ok' });
  });

  it('JSON:API vendor 타입이 아니라 평문 JSON으로 응답한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.headers['content-type']).toMatch(/^application\/json/);
  });

  it('없는 health 경로는 404다', async () => {
    const response = await request(app.getHttpServer()).get('/health/unknown');

    expect(response.status).toBe(404);
  });

  it('health 응답에는 vendor Content-Type을 붙이지 않는다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['content-type']).not.toContain('vnd.api+json');
  });

  it('없는 경로는 JSON:API 오류 문서로 응답한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/nope').expect(404);
    // `toContain`이 아니라 정확히 같은지 본다. JSON:API 1.1은 응답의 vendor 타입에
    // 미디어 타입 파라미터를 금지하는데, Express는 본문을 보내며 `charset=utf-8`을
    // 덧붙인다 — `toContain`은 그 위반을 통과시킨다. 이 저장소에서 전선에 나가는 값을
    // 실제로 확인하는 유일한 단언이다.
    expect(response.headers['content-type']).toBe('application/vnd.api+json');
    const body = response.body as { errors: { code: string; status: string }[] };
    const error = firstOf(body.errors);
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.status).toBe('404');
  });

  it('Accept-Language: en 이면 오류 title이 영어다', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/nope')
      .set('Accept-Language', 'en')
      .expect(404);
    const body = response.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.HTTP_ERROR.en);
  });

  it('Accept-Language가 없으면 오류 title이 한국어다', async () => {
    const response = await request(app.getHttpServer()).get('/health/nope').expect(404);
    const body = response.body as { errors: { title: string }[] };
    expect(firstOf(body.errors).title).toBe(ERROR_CATALOG.HTTP_ERROR.ko);
  });

  it('readiness가 데이터베이스를 확인한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(response.body as ReadyStatus).toEqual({ status: 'ok', database: 'ok' });
  });

  it('liveness는 데이터베이스를 확인하지 않는다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body as LiveStatus).toEqual({ status: 'ok' });
  });
});

/**
 * `ready()`의 DB 장애 경로는 HTTP 계층 테스트로는 만들 수 없다 — 위 `describe`가 쓰는
 * `app`은 실제로 살아 있는 테스트 DB에 붙어 있어야 다른 모든 테스트가 의미를 가진다.
 * 그래서 여기서는 `createTestApp()`을 거치지 않고 `HealthController`를 직접 생성한다.
 *
 * `DataSource`는 `new`로 만들되 `initialize()`는 부르지 않는다 — `query`를 직접
 * 대체할 것이므로 실제 연결이 필요 없다. 구조적으로 흉내만 낸 객체를 `DataSource`로
 * 캐스트하는 대신, 진짜 `DataSource` 인스턴스를 만들어 타입을 그대로 만족시킨다 — 이
 * 파일에도, 리포지토리 전체에도 컴파일러를 속이는 `as`는 없다.
 *
 * `jest.spyOn`/`jest.fn`은 쓰지 않는다. 이 프로젝트의 ESM + `--experimental-vm-modules`
 * 조합에서는 `jest` 전역이 테스트 모듈에 주입되지 않는다(`describe`/`it`/`expect`는
 * 주입되지만 `jest`는 아니다) — Jest의 공식 ESM 가이드가 `@jest/globals`에서
 * 명시적으로 import하라고 권하는 것도 이 때문이다. 그 패키지를 새 의존성으로 들이는
 * 대신, 인스턴스 프로퍼티를 직접 덮어써 같은 효과를 낸다 — 클래스 메서드는 프로토타입에
 * 있고 인스턴스 프로퍼티가 이를 가리므로, mocking 프레임워크 없이도 `query` 호출을
 * 가로챌 수 있다.
 */
describe('HealthController.ready() 단위 테스트', () => {
  const logged: { message: unknown; params: readonly unknown[] }[] = [];

  /**
   * 컨트롤러의 `Logger`를 가로챈다.
   *
   * 가로채지 않으면 아래 테스트가 일부러 만든 실패의 스택 트레이스를 테스트 출력에
   * 그대로 쏟아내, 초록으로 끝난 게이트가 실패한 것처럼 보인다. 잡음을 없애는 김에
   * "원인은 서버 로그로만 보낸다"는 컨트롤러의 계약도 함께 단언한다 — 응답에서 감춘
   * 원인을 운영자는 볼 수 있어야 하고, 그 절반은 지금까지 아무 테스트도 보지 않았다.
   */
  beforeAll(() => {
    Logger.overrideLogger({
      log: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      verbose: () => undefined,
      error: (message: unknown, ...params: unknown[]) => {
        logged.push({ message, params });
      },
    });
  });

  afterAll(() => {
    Logger.overrideLogger(new ConsoleLogger());
  });

  it('데이터베이스 질의가 실패하면 INTERNAL_SERVER_ERROR로 변환하고 원본 메시지를 감춘다', async () => {
    const dataSource = new DataSource(
      buildDataSourceOptions({
        url: 'postgres://stub:stub@127.0.0.1:5432/stub',
        poolMax: 1,
        idleTimeoutMs: 1000,
        connectionTimeoutMs: 1000,
      }),
    );
    const internalMessage = 'password authentication failed for user "stub"';
    dataSource.query = (): Promise<never> => Promise.reject(new Error(internalMessage));
    const controller = new HealthController(dataSource);

    logged.length = 0;
    expect.assertions(5);
    try {
      await controller.ready();
    } catch (error) {
      // `strictTypeChecked`의 `no-unsafe-*` 규칙 때문에 캐스트로 좁히지 않는다 — 실제
      // `instanceof` 분기로 좁히고, 예상 밖의 오류는 그대로 다시 던져 테스트를 실패시킨다.
      if (!(error instanceof JsonApiError)) {
        throw error;
      }
      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
      // 실패 원인(자격 증명, 호스트, 드라이버 오류 메시지 등)이 클라이언트로 새면 정보
      // 노출이 된다. `detail`은 카탈로그/컨트롤러가 고른 고정 문구여야 하고, DB가 실제로
      // 뭐라고 실패했는지는 절대 담기지 않아야 한다.
      expect(error.detail).toBe('the database is not reachable');
      expect(error.detail).not.toContain(internalMessage);
    }

    // 응답에서 감춘 원인은 서버 로그에 남아야 한다. 양쪽을 함께 단언해야 "감췄다"가
    // "잃어버렸다"로 조용히 바뀌는 것을 막을 수 있다.
    const entry = firstOf(logged);
    expect(String(entry.message)).toContain('database unreachable');
    expect(
      entry.params.some((param) => typeof param === 'string' && param.includes(internalMessage)),
    ).toBe(true);
  });
});
