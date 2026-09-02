import { JwtService } from '@nestjs/jwt';
import { JsonApiError } from '../../src/app/jsonapi/errors.js';
import { TokenService } from '../../src/app/auth/tokens.js';
import type { JwtSettings } from '../../src/config/settings.js';

const BASE: JwtSettings = {
  secret: 's'.repeat(32),
  issuer: '발급자',
  audience: '대상',
  accessExpiresSeconds: 900,
  refreshExpiresSeconds: 2592000,
  leewaySeconds: 0,
};

const USER = '0195c1a0-0000-7000-8000-00000000e001';
const SESSION = '0195c1a0-0000-7000-8000-00000000e002';

function service(overrides: Partial<JwtSettings> = {}): TokenService {
  return new TokenService({ ...BASE, ...overrides });
}

/** 던진 오류의 JSON:API 코드를 꺼낸다. 코드까지 봐야 401의 원인이 특정된다. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof JsonApiError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('오류가 나지 않았다');
}

describe('TokenService', () => {
  it('access token을 서명하고 다시 읽는다', () => {
    const tokens = service();
    expect(tokens.verifyAccessToken(tokens.signAccessToken(USER))).toEqual({ userId: USER });
  });

  it('refresh token은 세션 id를 함께 실어 나른다', () => {
    // 이 값이 `refresh_sessions` 행을 찾는 유일한 열쇠다. 빠지면 갱신이 어느 세션을
    // 회전시켜야 하는지 알 수 없다.
    const tokens = service();
    expect(tokens.verifyRefreshToken(tokens.signRefreshToken(USER, SESSION))).toEqual({
      userId: USER,
      sessionId: SESSION,
    });
  });

  it('refresh token을 access token 자리에서 거절한다', () => {
    // 이것을 통과시키면 30일짜리 token이 access token 노릇을 한다.
    const tokens = service();
    expect(codeOf(() => tokens.verifyAccessToken(tokens.signRefreshToken(USER, SESSION)))).toBe(
      'INVALID_TOKEN',
    );
  });

  it('access token을 refresh 자리에서 거절한다', () => {
    // `tokens.signAccessToken(USER)`로 만든 token은 `jti`가 없다. `typ` 검사를 통째로
    // 지워도 `claimString`이 그 `jti` 누락으로 대신 INVALID_TOKEN을 던지므로, 그렇게
    // 만든 token으로는 이 테스트가 `typ`가 아니라 `jti` 부재를 확인하는 셈이 된다.
    // `jti`를 실어 보내는 access-typ token을 직접 만들어 실패 이유를 `typ` 하나로
    // 좁힌다 — `claimString` 도달성 테스트에서 이미 쓴 방식(같은 비밀 키로 JwtService를
    // 직접 써서 서명)을 그대로 쓴다.
    const raw = new JwtService({ secret: BASE.secret }).sign(
      { typ: 'access' },
      {
        subject: USER,
        jwtid: SESSION,
        issuer: BASE.issuer,
        audience: BASE.audience,
        expiresIn: BASE.accessExpiresSeconds,
      },
    );
    expect(codeOf(() => service().verifyRefreshToken(raw))).toBe('INVALID_TOKEN');
  });

  it('다른 비밀 키로 서명된 token을 거절한다', () => {
    const other = service({ secret: 'z'.repeat(32) });
    expect(codeOf(() => service().verifyAccessToken(other.signAccessToken(USER)))).toBe(
      'INVALID_TOKEN',
    );
  });

  it('issuer가 다르면 거절한다', () => {
    // 만료되지 않은 token으로 확인해야 한다 — jsonwebtoken은 만료를 issuer보다 먼저
    // 보므로, 만료된 token을 쓰면 이 테스트가 issuer가 아니라 만료를 확인하게 된다.
    const other = service({ issuer: '다른 발급자' });
    expect(codeOf(() => service().verifyAccessToken(other.signAccessToken(USER)))).toBe(
      'INVALID_TOKEN',
    );
  });

  it('audience가 다르면 거절한다', () => {
    const other = service({ audience: '다른 대상' });
    expect(codeOf(() => service().verifyAccessToken(other.signAccessToken(USER)))).toBe(
      'INVALID_TOKEN',
    );
  });

  it('만료는 INVALID_TOKEN이 아니라 TOKEN_EXPIRED다', () => {
    // 두 오류를 가르는 것이 이 매핑의 요점이다. `TokenExpiredError`가
    // `JsonWebTokenError`를 상속하므로 만료를 먼저 검사하지 않으면 전부
    // INVALID_TOKEN으로 뭉개진다.
    //
    // `jest.useFakeTimers()`는 쓰지 않는다 — 이 프로젝트의 ESM + `--experimental-vm-modules`
    // 조합에서는 `jest` 전역이 테스트 모듈에 주입되지 않는다(`test/health.controller.spec.ts`가
    // 이미 문서화한 제약과 같다). `jsonwebtoken`은 `clockTimestamp` 옵션이 없으면 검증
    // 시점에 `Date.now()`를 직접 불러 "지금"을 정하므로(`verify.js`), 전역 `Date.now`를
    // 검증 호출 동안만 바꿔치기하면 fake timer 없이도 같은 효과를 낸다.
    const realNow = Date.now;
    try {
      const tokens = service({ accessExpiresSeconds: 1 });
      const token = tokens.signAccessToken(USER);
      Date.now = (): number => realNow() + 5_000;
      expect(codeOf(() => tokens.verifyAccessToken(token))).toBe('TOKEN_EXPIRED');
    } finally {
      Date.now = realNow;
    }
  });

  it('유예 안에서 만료된 token은 통과시킨다', () => {
    // `clockTolerance`가 실제로 배선됐는지 본다. 설정만 읽고 넘기지 않았는지.
    // fake timer를 쓰지 않는 이유는 위 테스트와 같다.
    const realNow = Date.now;
    try {
      const tokens = service({ accessExpiresSeconds: 1, leewaySeconds: 60 });
      const token = tokens.signAccessToken(USER);
      Date.now = (): number => realNow() + 30_000;
      expect(tokens.verifyAccessToken(token)).toEqual({ userId: USER });
    } finally {
      Date.now = realNow;
    }
  });

  it('JWT가 아닌 문자열도 조용히 401이다', () => {
    // 500으로 새면 공격자에게 스택 트레이스를 준다.
    expect(codeOf(() => service().verifyAccessToken('토큰이-아니다'))).toBe('INVALID_TOKEN');
  });

  it('서명은 유효하지만 sub 클레임이 없는 token은 INVALID_TOKEN이다', () => {
    // `claimString`이 지키는 경계다 — `TokenService.signAccessToken`은 항상 문자열
    // `subject`를 실어 보내므로 이 모양은 공개 API로는 만들 수 없다. 서명은 비밀
    // 키만 있으면 맞출 수 있으므로, 비밀 키를 쥔 쪽이 다른 모양으로 만든 token일
    // 수 있다는 것이 `claimString` 주석의 요점이다. `jsonwebtoken`을 직접 import하지
    // 않고, 이 프로젝트의 직접 의존성인 `@nestjs/jwt`의 `JwtService`로 같은 비밀
    // 키를 써서 그 모양을 재현한다.
    const raw = new JwtService({ secret: BASE.secret }).sign(
      { typ: 'access' },
      { issuer: BASE.issuer, audience: BASE.audience, expiresIn: BASE.accessExpiresSeconds },
    );
    expect(codeOf(() => service().verifyAccessToken(raw))).toBe('INVALID_TOKEN');
  });
});
