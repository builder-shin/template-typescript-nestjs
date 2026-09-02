import { requireTestDatabaseUrl, requireTestRedisUrl } from './fixture.js';

describe('requireTestDatabaseUrl', () => {
  it('TEST_DATABASE_URL이 없으면 변수 이름이 담긴 오류', () => {
    expect(() => requireTestDatabaseUrl({})).toThrow('TEST_DATABASE_URL is required');
  });

  it('공백뿐이면 거부한다', () => {
    expect(() => requireTestDatabaseUrl({ TEST_DATABASE_URL: '  ' })).toThrow(
      'TEST_DATABASE_URL is required',
    );
  });

  it('_test로 끝나는 DB 이름을 받는다', () => {
    const url = 'postgres://u:p@localhost:5432/app_test';
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  it('_test로 끝나지 않으면 거부한다', () => {
    expect(() =>
      requireTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/app' }),
    ).toThrow('TEST_DATABASE_URL database name must end with "_test"');
  });

  it('운영처럼 보이는 이름도 예외 없이 거부한다', () => {
    expect(() =>
      requireTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@db.internal:5432/production' }),
    ).toThrow('must end with "_test"');
  });

  it('쿼리 문자열이 붙어도 DB 이름을 정확히 읽는다', () => {
    const url = 'postgres://u:p@localhost:5432/app_test?sslmode=disable';
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  it('끝에 슬래시가 붙어도 DB 이름을 정확히 읽는다', () => {
    const url = 'postgres://u:p@localhost:5432/app_test/';
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  it('경로 세그먼트가 여러 개면 접미사가 맞아도 거부한다', () => {
    expect(() =>
      requireTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgres://u:p@host:5432/production/app_test',
      }),
    ).toThrow('TEST_DATABASE_URL must have exactly one path segment');
  });

  it('URL 형식이 아니면 거부한다', () => {
    expect(() => requireTestDatabaseUrl({ TEST_DATABASE_URL: 'not-a-url' })).toThrow(
      'TEST_DATABASE_URL must be a valid connection URL',
    );
  });

  it('실제 게이트가 넘겨준 값을 받아들인다', () => {
    // check.sh는 nestjs_template_test를 만든다. 이 테스트가 그 계약을 고정한다.
    const url = 'postgres://nestjs:nestjs@127.0.0.1:55432/nestjs_template_test';
    expect(requireTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });
});

describe('requireTestRedisUrl', () => {
  it('TEST_REDIS_URL이 없으면 변수 이름이 담긴 오류', () => {
    expect(() => requireTestRedisUrl({})).toThrow('TEST_REDIS_URL is required');
  });

  it('공백뿐이면 거부한다', () => {
    expect(() => requireTestRedisUrl({ TEST_REDIS_URL: '  ' })).toThrow(
      'TEST_REDIS_URL is required',
    );
  });

  it('URL 형식이 아니면 거부한다', () => {
    expect(() => requireTestRedisUrl({ TEST_REDIS_URL: 'not-a-url' })).toThrow(
      'TEST_REDIS_URL must be a valid connection URL',
    );
  });

  it('실제 게이트가 넘겨준 값을 받아들인다', () => {
    // check.sh는 redis://127.0.0.1:<임시 포트> 형태로 내보낸다. 이 테스트가 그
    // 계약을 고정한다.
    const url = 'redis://127.0.0.1:56379';
    expect(requireTestRedisUrl({ TEST_REDIS_URL: url })).toBe(url);
  });

  it('개발용으로 보이는 URL도 지금은 막지 못하고 그대로 통과한다', () => {
    // requireTestDatabaseUrl과 달리 이 함수에는 "테스트 전용"을 판정할 이름 규칙이
    // 없다(JSDoc 참고) — Redis URL은 호스트·포트·DB 인덱스뿐이라 무엇을 봐도 개발용과
    // 구분되지 않는다. 그 사실을 놓치지 않도록, "지금은 막지 못한다"를 여기 실행
    // 가능한 형태로 고정해 둔다. 이 테스트가 깨진다면 그것은 누군가 실제로 안전장치를
    // 추가했다는 뜻이어야 한다 — 그때는 이 테스트를 지우고 새 가드의 계약을 테스트로
    // 남기면 된다.
    const devLookingUrl = 'redis://127.0.0.1:6379'; // 로컬 개발 Redis의 흔한 기본값과 동일한 모양
    expect(requireTestRedisUrl({ TEST_REDIS_URL: devLookingUrl })).toBe(devLookingUrl);
  });
});
