import { validateAttributes } from '../../src/app/schemas/write-schema.js';
import {
  AuthCredentials,
  RefreshTokenInput,
  UserRegister,
} from '../../src/app/schemas/auth.schemas.js';

describe('UserRegister', () => {
  it('이메일을 소문자로 정규화한다', async () => {
    // 대소문자만 다른 두 계정이 생기면 로그인이 어느 쪽으로 붙을지 입력에 따라 갈리고,
    // 그 상태는 유니크 제약으로 되돌릴 수 없다. 정규화 지점은 이 스키마 하나뿐이다.
    const parsed = await validateAttributes(UserRegister, {
      email: 'Ko@Example.Com',
      password: '충분히-긴-비밀번호12',
    });
    expect(parsed.email).toBe('ko@example.com');
  });

  it('이메일 모양이 아니면 거절한다', async () => {
    await expect(
      validateAttributes(UserRegister, { email: '이메일아님', password: '충분히-긴-비밀번호12' }),
    ).rejects.toBeDefined();
  });

  it('비밀번호가 12자보다 짧으면 거절한다', async () => {
    // 스펙 9장이 정한 하한이다.
    await expect(
      validateAttributes(UserRegister, { email: 'a@example.com', password: '짧다' }),
    ).rejects.toBeDefined();
  });

  it('비밀번호가 128자를 넘으면 거절한다', async () => {
    await expect(
      validateAttributes(UserRegister, { email: 'a@example.com', password: 'a'.repeat(129) }),
    ).rejects.toBeDefined();
  });

  it('모르는 필드를 거절한다', async () => {
    // `isActive`를 가입 요청으로 넣을 수 있으면 누구나 자기 계정을 활성화한다.
    await expect(
      validateAttributes(UserRegister, {
        email: 'a@example.com',
        password: '충분히-긴-비밀번호12',
        isActive: true,
      }),
    ).rejects.toBeDefined();
  });
});

describe('AuthCredentials', () => {
  it('requires the same password limits as registration', async () => {
    await expect(
      validateAttributes(AuthCredentials, { email: 'a@example.com', password: 'short' }),
    ).rejects.toBeDefined();
  });

  it('상한은 둔다', async () => {
    // 무한히 긴 문자열을 해시하게 두면 그것이 곧 부하 공격이다.
    await expect(
      validateAttributes(AuthCredentials, {
        email: 'a@example.com',
        password: 'a'.repeat(129),
      }),
    ).rejects.toBeDefined();
  });

  it('이메일을 소문자로 정규화한다', async () => {
    // 가입과 같은 규칙이어야 저장된 행을 찾을 수 있다.
    const parsed = await validateAttributes(AuthCredentials, {
      email: 'KO@EXAMPLE.COM',
      password: 'canonical-password-123',
    });
    expect(parsed.email).toBe('ko@example.com');
  });
});

describe('RefreshTokenInput', () => {
  it('토큰 문자열을 받는다', async () => {
    const parsed = await validateAttributes(RefreshTokenInput, { refreshToken: 'abc.def.ghi' });
    expect(parsed.refreshToken).toBe('abc.def.ghi');
  });

  it('빈 문자열을 거절한다', async () => {
    await expect(validateAttributes(RefreshTokenInput, { refreshToken: '' })).rejects.toBeDefined();
  });
});

describe('canonical email normalization', () => {
  it.each([
    ['  Stra\u00dfe@EXAMPLE.COM  ', 'strasse@example.com'],
    ['\u03a3\u03c2@example.com', '\u03c3\u03c3@example.com'],
  ])('normalizes %s', async (email, expected) => {
    const parsed = await validateAttributes(UserRegister, {
      email,
      password: 'canonical-password-123',
    });
    expect(parsed.email).toBe(expected);
  });
  it('rejects addresses longer than 254 characters', async () => {
    const email =
      'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(60) + '.test';
    await expect(
      validateAttributes(UserRegister, { email, password: 'canonical-password-123' }),
    ).rejects.toBeDefined();
  });
});
