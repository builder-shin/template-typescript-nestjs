import { requireTestDatabaseUrl } from './fixture.js';

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
