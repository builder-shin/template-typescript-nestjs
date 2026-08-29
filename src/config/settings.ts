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

/** HTTP 서버 설정. */
export interface ServerSettings {
  readonly port: number;
}

/** HTTP 서버 설정을 환경에서 읽는다. */
export function loadServerSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  return { port: optionalNonNegativeInteger('PORT', 4000, env) };
}
