import {
  SettingsError,
  loadServerSettings,
  optionalInteger,
  optionalNonNegativeInteger,
  requireEnv,
} from '../../src/config/settings.js';

describe('requireEnv', () => {
  it('값이 있으면 그대로 돌려준다', () => {
    expect(requireEnv('DATABASE_URL', { DATABASE_URL: 'postgres://x' })).toBe('postgres://x');
  });

  it('없으면 변수 이름이 담긴 오류를 던진다', () => {
    expect(() => requireEnv('DATABASE_URL', {})).toThrow(SettingsError);
    expect(() => requireEnv('DATABASE_URL', {})).toThrow('DATABASE_URL is required');
  });

  it('공백만 있는 값은 없는 것으로 취급한다', () => {
    expect(() => requireEnv('DATABASE_URL', { DATABASE_URL: '   ' })).toThrow(
      'DATABASE_URL is required',
    );
  });
});

describe('optionalInteger', () => {
  it('값이 없으면 기본값을 쓴다', () => {
    expect(optionalInteger('DB_POOL_MAX', 10, {})).toBe(10);
  });

  it('정수 문자열을 파싱한다', () => {
    expect(optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: '25' })).toBe(25);
  });

  it('앞뒤 공백을 허용한다', () => {
    expect(optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: ' 25 ' })).toBe(25);
  });

  it('정수가 아니면 변수 이름이 담긴 오류를 던진다', () => {
    expect(() => optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: '2.5' })).toThrow(
      'DB_POOL_MAX must be an integer',
    );
    expect(() => optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: 'abc' })).toThrow(
      'DB_POOL_MAX must be an integer',
    );
  });

  it('음수도 정수로 받는다', () => {
    expect(optionalInteger('JWT_LEEWAY_SECONDS', 0, { JWT_LEEWAY_SECONDS: '-5' })).toBe(-5);
  });
});

describe('optionalNonNegativeInteger', () => {
  it('음수를 거부한다', () => {
    expect(() =>
      optionalNonNegativeInteger('REFRESH_SESSION_RETENTION_SECONDS', 604800, {
        REFRESH_SESSION_RETENTION_SECONDS: '-1',
      }),
    ).toThrow('REFRESH_SESSION_RETENTION_SECONDS must be non-negative');
  });

  it('0을 허용한다', () => {
    expect(optionalNonNegativeInteger('JWT_LEEWAY_SECONDS', 5, { JWT_LEEWAY_SECONDS: '0' })).toBe(
      0,
    );
  });
});

describe('loadServerSettings', () => {
  it('PORT 기본값은 4000이다', () => {
    expect(loadServerSettings({})).toEqual({ port: 4000 });
  });

  it('PORT를 환경에서 읽는다', () => {
    expect(loadServerSettings({ PORT: '8080' })).toEqual({ port: 8080 });
  });

  it('PORT가 정수가 아니면 거부한다', () => {
    expect(() => loadServerSettings({ PORT: 'http' })).toThrow('PORT must be an integer');
  });
});

describe('env 인자를 생략했을 때의 기본값', () => {
  const PROBE = 'SETTINGS_DEFAULT_ENV_PROBE';

  afterEach(() => {
    Reflect.deleteProperty(process.env, PROBE);
    delete process.env.PORT;
  });

  it('requireEnv는 process.env를 읽는다', () => {
    process.env[PROBE] = 'from-process-env';

    expect(requireEnv(PROBE)).toBe('from-process-env');
  });

  it('optionalInteger는 process.env를 읽는다', () => {
    process.env[PROBE] = '42';

    expect(optionalInteger(PROBE, 10)).toBe(42);
  });

  it('optionalNonNegativeInteger는 process.env를 읽는다', () => {
    process.env[PROBE] = '7';

    expect(optionalNonNegativeInteger(PROBE, 10)).toBe(7);
  });

  it('loadServerSettings는 process.env를 읽는다', () => {
    process.env.PORT = '9090';

    expect(loadServerSettings()).toEqual({ port: 9090 });
  });
});
