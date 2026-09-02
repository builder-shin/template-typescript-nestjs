/**
 * 환경 변수 파싱 프리미티브.
 *
 * 애플리케이션 코드에 암묵적 기본값을 두지 않는다. 필수 값이 없으면 변수 이름이 담긴
 * 오류로 프로세스가 시작되지 않는다. 각 Phase는 자기 설정 로더를 이 프리미티브 위에 얹는다.
 */

const INTEGER_PATTERN = /^-?\d+$/;

/** 설정 해석 실패. 프로세스 시작을 막는 것이 목적이다. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

/** 필수 환경 변수를 읽는다. 없거나 공백뿐이면 실패한다. */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new SettingsError(`${name} is required`);
  }
  return raw;
}

/** 선택 정수 환경 변수를 읽는다. 값이 없으면 `fallback`, 정수가 아니면 실패한다. */
export function optionalInteger(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new SettingsError(`${name} must be an integer`);
  }
  return Number.parseInt(trimmed, 10);
}

/** 음수를 허용하지 않는 선택 정수 환경 변수를 읽는다. */
export function optionalNonNegativeInteger(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = optionalInteger(name, fallback, env);
  if (value < 0) {
    throw new SettingsError(`${name} must be non-negative`);
  }
  return value;
}

/**
 * 없거나 공백뿐이면 기본값을 쓰는 문자열.
 *
 * "없음"의 판정 기준을 `requireEnv`와 맞춘다(트림해서 비었는가). 두 함수가 기준을
 * 달리하면 같은 값이 한쪽에서는 있고 한쪽에서는 없는 것이 되어, 어느 변수가 어느
 * 함수를 타는지에 따라 동작이 갈린다.
 */
export function optionalString(
  name: string,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

/**
 * UTF-8 바이트 길이 하한이 있는 필수 문자열.
 *
 * 문자 수가 아니라 바이트 수로 재는 이유: 서명 키의 강도를 정하는 것은 바이트다.
 * 한글 한 글자는 UTF-8에서 3바이트라, 문자 수로 재면 같은 강도의 키를 서로 다르게
 * 판정한다.
 *
 * 잴 때는 트림하고 돌려줄 때는 원본을 준다. 트림하지 않고 재면 공백으로 하한을
 * 채운 키가 통과하고, 돌려줄 때 트림하면 `requireEnv`와 반환 규칙이 갈라진다.
 */
export function requireEnvMinBytes(
  name: string,
  minBytes: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = requireEnv(name, env);
  if (Buffer.byteLength(value.trim(), 'utf8') < minBytes) {
    throw new SettingsError(`${name} must be at least ${String(minBytes)} bytes (UTF-8)`);
  }
  return value;
}

/** HTTP 서버 설정. */
export interface ServerSettings {
  readonly port: number;
}

/** HTTP 서버 설정을 환경에서 읽는다. */
export function loadServerSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  return { port: optionalNonNegativeInteger('PORT', 4000, env) };
}

/** 데이터베이스 접속과 커넥션 풀 설정. */
export interface DatabaseSettings {
  readonly url: string;
  readonly poolMax: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
}

/**
 * 데이터베이스 설정을 환경에서 읽는다.
 *
 * `DB_POOL_MAX`는 1 이상이어야 한다. 0을 허용하면 커넥션을 영원히 얻지 못해 모든
 * 질의가 조용히 매달리는데, 그 증상은 설정 오류처럼 보이지 않아 진단이 오래 걸린다.
 * 그래서 `optionalNonNegativeInteger`(0을 통과시킨다)를 쓰지 않고 하한을 따로 검사한다.
 */
export function loadDatabaseSettings(env: NodeJS.ProcessEnv = process.env): DatabaseSettings {
  const poolMax = optionalInteger('DB_POOL_MAX', 10, env);
  if (poolMax < 1) {
    throw new SettingsError('DB_POOL_MAX must be at least 1');
  }

  return {
    url: requireEnv('DATABASE_URL', env),
    poolMax,
    idleTimeoutMs: optionalNonNegativeInteger('DB_POOL_IDLE_TIMEOUT_MS', 30000, env),
    connectionTimeoutMs: optionalNonNegativeInteger('DB_POOL_CONNECTION_TIMEOUT_MS', 30000, env),
  };
}

/** JWT 서명과 검증 설정. */
export interface JwtSettings {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessExpiresSeconds: number;
  readonly refreshExpiresSeconds: number;
  readonly leewaySeconds: number;
}

/**
 * JWT 설정을 환경에서 읽는다.
 *
 * 만료 두 개는 1초 이상이어야 한다. 0이나 음수를 통과시키면 발급되자마자 만료된
 * token이 나가고, 증상("모든 요청이 401")이 원인(설정 한 줄)을 전혀 가리키지 않는다.
 * 유예는 0이 정상값이라 하한이 다르다 — `optionalNonNegativeInteger`가 그 차이를
 * 이미 표현한다.
 */
export function loadJwtSettings(env: NodeJS.ProcessEnv = process.env): JwtSettings {
  const accessExpiresSeconds = optionalInteger('JWT_ACCESS_EXPIRES_SECONDS', 900, env);
  if (accessExpiresSeconds < 1) {
    throw new SettingsError('JWT_ACCESS_EXPIRES_SECONDS must be at least 1');
  }

  const refreshExpiresSeconds = optionalInteger('JWT_REFRESH_EXPIRES_SECONDS', 2592000, env);
  if (refreshExpiresSeconds < 1) {
    throw new SettingsError('JWT_REFRESH_EXPIRES_SECONDS must be at least 1');
  }

  return {
    secret: requireEnvMinBytes('JWT_SECRET_KEY', 32, env),
    issuer: optionalString('JWT_ISSUER', 'template-typescript-nestjs', env),
    audience: optionalString('JWT_AUDIENCE', 'template-typescript-nestjs', env),
    accessExpiresSeconds,
    refreshExpiresSeconds,
    leewaySeconds: optionalNonNegativeInteger('JWT_LEEWAY_SECONDS', 0, env),
  };
}
