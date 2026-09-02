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
      email: 'Ko@Example.Test',
      password: '충분히-긴-비밀번호12',
    });
    expect(parsed.email).toBe('ko@example.test');
  });

  it('이메일 모양이 아니면 거절한다', async () => {
    await expect(
      validateAttributes(UserRegister, { email: '이메일아님', password: '충분히-긴-비밀번호12' }),
    ).rejects.toBeDefined();
  });

  it('비밀번호가 12자보다 짧으면 거절한다', async () => {
    // 스펙 9장이 정한 하한이다.
    await expect(
      validateAttributes(UserRegister, { email: 'a@example.test', password: '짧다' }),
    ).rejects.toBeDefined();
  });

  it('비밀번호가 128자를 넘으면 거절한다', async () => {
    await expect(
      validateAttributes(UserRegister, { email: 'a@example.test', password: 'a'.repeat(129) }),
    ).rejects.toBeDefined();
  });

  it('모르는 필드를 거절한다', async () => {
    // `isActive`를 가입 요청으로 넣을 수 있으면 누구나 자기 계정을 활성화한다.
    await expect(
      validateAttributes(UserRegister, {
        email: 'a@example.test',
        password: '충분히-긴-비밀번호12',
        isActive: true,
      }),
    ).rejects.toBeDefined();
  });
});

describe('AuthCredentials', () => {
  it('길이 정책을 강제하지 않는다', async () => {
    // 정책이 나중에 강해져도 기존 사용자가 로그인할 수 있어야 하고, 길이 위반을
    // 422로 알려 주면 공격자에게 정책을 알려 주는 셈이다. 대조는 argon2가 한다.
    const parsed = await validateAttributes(AuthCredentials, {
      email: 'a@example.test',
      password: '짧다',
    });
    expect(parsed.password).toBe('짧다');
  });

  it('상한은 둔다', async () => {
    // 무한히 긴 문자열을 해시하게 두면 그것이 곧 부하 공격이다.
    await expect(
      validateAttributes(AuthCredentials, {
        email: 'a@example.test',
        password: 'a'.repeat(1025),
      }),
    ).rejects.toBeDefined();
  });

  it('이메일을 소문자로 정규화한다', async () => {
    // 가입과 같은 규칙이어야 저장된 행을 찾을 수 있다.
    const parsed = await validateAttributes(AuthCredentials, {
      email: 'KO@EXAMPLE.TEST',
      password: '충분히-긴-비밀번호',
    });
    expect(parsed.email).toBe('ko@example.test');
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
