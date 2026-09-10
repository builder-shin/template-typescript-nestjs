import {
  SettingsError,
  loadDatabaseSettings,
  loadJwtSettings,
  loadServerSettings,
  loadWorkerSettings,
  optionalInteger,
  optionalNonNegativeInteger,
  optionalString,
  requireEnv,
  requireEnvMinBytes,
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
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) {
        Reflect.deleteProperty(process.env, key);
      }
    }
    Object.assign(process.env, snapshot);
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

describe('loadDatabaseSettings', () => {
  const url = 'postgres://user:pass@localhost:5432/app';

  it('DATABASE_URL이 없으면 변수 이름이 담긴 오류', () => {
    expect(() => loadDatabaseSettings({})).toThrow(SettingsError);
    expect(() => loadDatabaseSettings({})).toThrow('DATABASE_URL is required');
  });

  it('DATABASE_URL이 공백뿐이면 거부한다', () => {
    expect(() => loadDatabaseSettings({ DATABASE_URL: '   ' })).toThrow('DATABASE_URL is required');
  });

  it('기본값을 스펙대로 적용한다', () => {
    const settings = loadDatabaseSettings({ DATABASE_URL: url });
    expect(settings.url).toBe(url);
    expect(settings.poolMax).toBe(10);
    expect(settings.idleTimeoutMs).toBe(30000);
    expect(settings.connectionTimeoutMs).toBe(30000);
  });

  it('DB_POOL_MAX를 읽는다', () => {
    expect(loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: '25' }).poolMax).toBe(25);
  });

  it('DB_POOL_MAX가 정수가 아니면 거부한다', () => {
    expect(() => loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: 'x' })).toThrow(
      'DB_POOL_MAX must be an integer',
    );
  });

  it('DB_POOL_MAX가 0 이하면 거부한다', () => {
    expect(() => loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: '0' })).toThrow(
      'DB_POOL_MAX must be at least 1',
    );
    expect(() => loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_MAX: '-1' })).toThrow(
      'DB_POOL_MAX must be at least 1',
    );
  });

  it('타임아웃을 읽는다', () => {
    const settings = loadDatabaseSettings({
      DATABASE_URL: url,
      DB_POOL_IDLE_TIMEOUT_MS: '1000',
      DB_POOL_CONNECTION_TIMEOUT_MS: '2000',
    });
    expect(settings.idleTimeoutMs).toBe(1000);
    expect(settings.connectionTimeoutMs).toBe(2000);
  });

  it('타임아웃이 음수면 거부한다', () => {
    expect(() =>
      loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_IDLE_TIMEOUT_MS: '-1' }),
    ).toThrow('DB_POOL_IDLE_TIMEOUT_MS must be non-negative');
    expect(() =>
      loadDatabaseSettings({ DATABASE_URL: url, DB_POOL_CONNECTION_TIMEOUT_MS: '-1' }),
    ).toThrow('DB_POOL_CONNECTION_TIMEOUT_MS must be non-negative');
  });

  describe('env 인자를 생략했을 때의 기본값', () => {
    let snapshot: NodeJS.ProcessEnv;

    beforeEach(() => {
      snapshot = { ...process.env };
    });

    afterEach(() => {
      for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) {
          Reflect.deleteProperty(process.env, key);
        }
      }
      Object.assign(process.env, snapshot);
    });

    it('loadDatabaseSettings는 process.env를 읽는다', () => {
      process.env.DATABASE_URL = url;

      expect(loadDatabaseSettings()).toEqual({
        url,
        poolMax: 10,
        idleTimeoutMs: 30000,
        connectionTimeoutMs: 30000,
      });
    });
  });
});

describe('optionalString', () => {
  it('없으면 기본값을 쓴다', () => {
    expect(optionalString('MISSING', '기본', {})).toBe('기본');
  });

  it('공백뿐이면 기본값을 쓴다', () => {
    // `requireEnv`가 "없음"을 판정하는 기준과 같아야 한다. 두 함수가 기준을 달리하면
    // 같은 값이 한쪽에서는 있고 한쪽에서는 없는 것이 된다.
    expect(optionalString('BLANK', '기본', { BLANK: '   ' })).toBe('기본');
  });

  it('값이 있으면 그대로 쓴다', () => {
    expect(optionalString('SET', '기본', { SET: '값' })).toBe('값');
  });
});

describe('requireEnvMinBytes', () => {
  it('하한을 넘으면 원본을 그대로 돌려준다', () => {
    const secret = 'a'.repeat(32);
    expect(requireEnvMinBytes('SECRET', 32, { SECRET: secret })).toBe(secret);
  });

  it('바이트가 모자라면 변수 이름과 하한이 담긴 오류다', () => {
    expect(() => requireEnvMinBytes('SECRET', 32, { SECRET: 'a'.repeat(31) })).toThrow(
      'SECRET must be at least 32 bytes (UTF-8)',
    );
  });

  it('문자 수가 아니라 UTF-8 바이트 수로 잰다', () => {
    // 한글 한 글자는 UTF-8에서 3바이트다. 11자면 33바이트라 32바이트 하한을 넘는다 —
    // 문자 수로 쟀다면 11 < 32라서 거절됐을 값이다. 서명 키의 강도를 정하는 것은
    // 바이트 수이므로 이쪽이 맞다.
    expect(requireEnvMinBytes('SECRET', 32, { SECRET: '가'.repeat(11) })).toBe('가'.repeat(11));
  });

  it('앞뒤 공백으로 하한을 채울 수 없다', () => {
    // 트림한 값으로 재지 않으면 공백 30개 + 문자 2개가 32바이트로 통과한다.
    expect(() => requireEnvMinBytes('SECRET', 32, { SECRET: `${' '.repeat(30)}ab` })).toThrow(
      'SECRET must be at least 32 bytes (UTF-8)',
    );
  });

  it('하한을 넘겨도 앞뒤 공백은 트림하지 않고 원본 그대로 돌려준다', () => {
    // 재는 것과 돌려주는 것은 비대칭이다 — 트림한 값으로 재고, 트림하지 않은 원본을
    // 돌려준다. `requireEnv`와 반환 규칙이 갈리면 안 되기 때문이다. 공백 없는 입력만
    // 쓰면 `return value.trim();`으로 바꿔도 이 파일의 다른 케이스가 전부 통과해
    // 이 비대칭이 고정되지 않는다.
    const withSpaces = `  ${'a'.repeat(32)}  `;
    expect(requireEnvMinBytes('SECRET', 32, { SECRET: withSpaces })).toBe(withSpaces);
  });

  it('없으면 requireEnv의 오류를 그대로 낸다', () => {
    expect(() => requireEnvMinBytes('SECRET', 32, {})).toThrow('SECRET is required');
  });
});

describe('loadJwtSettings', () => {
  const secret = 'x'.repeat(32);

  it('기본값은 스펙 12장의 표와 같다', () => {
    expect(loadJwtSettings({ JWT_SECRET_KEY: secret })).toEqual({
      secret,
      issuer: 'template-typescript-nestjs',
      audience: 'template-typescript-nestjs',
      accessExpiresSeconds: 900,
      refreshExpiresSeconds: 2592000,
      leewaySeconds: 0,
    });
  });

  it('비밀 키가 없으면 시작하지 않는다', () => {
    expect(() => loadJwtSettings({})).toThrow('JWT_SECRET_KEY is required');
  });

  it('access 만료가 0이면 거절한다', () => {
    // 0초짜리 access token은 발급되자마자 만료다. 설정 실수가 "모든 요청이 401"로
    // 나타나면 원인을 찾기 어렵다 — 시작 시점에 거절하는 편이 싸다.
    expect(() =>
      loadJwtSettings({ JWT_SECRET_KEY: secret, JWT_ACCESS_EXPIRES_SECONDS: '0' }),
    ).toThrow('JWT_ACCESS_EXPIRES_SECONDS must be at least 1');
  });

  it('refresh 만료가 음수면 거절한다', () => {
    expect(() =>
      loadJwtSettings({ JWT_SECRET_KEY: secret, JWT_REFRESH_EXPIRES_SECONDS: '-1' }),
    ).toThrow('JWT_REFRESH_EXPIRES_SECONDS must be at least 1');
  });

  it('유예는 0을 허용하고 음수를 거절한다', () => {
    // 유예 0은 "유예 없음"이라는 정상 설정이다. 음수는 만료 전 token을 만료로 보게
    // 만들어 뜻이 없다.
    expect(loadJwtSettings({ JWT_SECRET_KEY: secret, JWT_LEEWAY_SECONDS: '0' }).leewaySeconds).toBe(
      0,
    );
    expect(() => loadJwtSettings({ JWT_SECRET_KEY: secret, JWT_LEEWAY_SECONDS: '-1' })).toThrow(
      'JWT_LEEWAY_SECONDS must be non-negative',
    );
  });

  it('issuer와 audience를 각각 덮어쓸 수 있다', () => {
    const settings = loadJwtSettings({
      JWT_SECRET_KEY: secret,
      JWT_ISSUER: '발급자',
      JWT_AUDIENCE: '대상',
    });
    expect(settings.issuer).toBe('발급자');
    expect(settings.audience).toBe('대상');
  });
});

describe('loadWorkerSettings', () => {
  const redisUrl = 'redis://127.0.0.1:6379';

  it('기본값은 스펙 12장의 표와 같다', () => {
    expect(loadWorkerSettings({ REDIS_URL: redisUrl })).toEqual({
      redisUrl,
      refreshSessionRetentionSeconds: 604800,
    });
  });

  it('REDIS_URL이 없으면 워커가 시작하지 않는다', () => {
    // 스펙 12장: 암묵적 기본값을 두지 않는다. 잘못된 Redis에 조용히 붙는 것보다
    // 시작 실패가 낫다.
    expect(() => loadWorkerSettings({})).toThrow('REDIS_URL is required');
  });

  it('보존 기간이 음수면 거절한다', () => {
    // 음수 보존 기간은 "미래의 행도 지운다"는 뜻이 되어 아직 유효한 세션을 지운다.
    expect(() =>
      loadWorkerSettings({ REDIS_URL: redisUrl, REFRESH_SESSION_RETENTION_SECONDS: '-1' }),
    ).toThrow('REFRESH_SESSION_RETENTION_SECONDS must be non-negative');
  });

  it('보존 기간 0은 허용한다', () => {
    // 0은 "만료되는 즉시 지운다"는 정상 설정이다.
    expect(
      loadWorkerSettings({ REDIS_URL: redisUrl, REFRESH_SESSION_RETENTION_SECONDS: '0' })
        .refreshSessionRetentionSeconds,
    ).toBe(0);
  });
});
