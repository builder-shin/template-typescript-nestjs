import { serializeResource } from '../../src/app/serializers/serializer.js';
import { AUTH_TOKENS_SERIALIZER, USER_SERIALIZER } from '../../src/app/serializers/index.js';
import { User } from '../../src/app/models/user.entity.js';

function sampleUser(): User {
  const user = new User();
  user.id = '0195c1a0-0000-7000-8000-00000000f001';
  user.email = 'ko@example.test';
  user.passwordHash = '$argon2id$비밀';
  user.isActive = true;
  user.createdAt = new Date('2026-09-02T00:00:00.000Z');
  user.updatedAt = new Date('2026-09-02T00:00:00.000Z');
  return user;
}

describe('USER_SERIALIZER', () => {
  it('비밀번호 해시를 절대 내보내지 않는다', () => {
    // 이 단언 하나가 계정 탈취와 그렇지 않은 것을 가른다. 필드를 추가하는 사람이
    // 실수로 넣으면 여기서 걸려야 한다.
    const resource = serializeResource(USER_SERIALIZER, sampleUser());
    expect(JSON.stringify(resource)).not.toContain('argon2');
    expect(Object.keys(resource.attributes)).toEqual([
      'email',
      'isActive',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('self 링크를 내지 않는다', () => {
    // 스펙 16장에 `GET /api/v1/users/{id}`가 없다. 링크를 지어내면 클라이언트가
    // 404를 따라간다.
    expect(serializeResource(USER_SERIALIZER, sampleUser())).not.toHaveProperty('links');
  });
});

describe('AUTH_TOKENS_SERIALIZER', () => {
  it('토큰 묶음을 자원 하나로 낸다', () => {
    const resource = serializeResource(AUTH_TOKENS_SERIALIZER, {
      id: '0195c1a0-0000-7000-8000-00000000f002',
      accessToken: 'access.token.value',
      refreshToken: 'refresh.token.value',
      accessTokenExpiresIn: 900,
      refreshTokenExpiresAt: new Date('2026-10-02T00:00:00.000Z'),
    });

    expect(resource.type).toBe('authTokens');
    expect(resource.id).toBe('0195c1a0-0000-7000-8000-00000000f002');
    expect(resource.attributes).toEqual({
      accessToken: 'access.token.value',
      refreshToken: 'refresh.token.value',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshTokenExpiresAt: '2026-10-02T00:00:00.000Z',
    });
  });

  it('테이블이 없는 자원도 self 링크 없이 직렬화된다', () => {
    // `serializeResource`는 `entity.id`만 읽고 DB를 보지 않는다 — 그래서 영속화되지
    // 않는 자원도 그대로 통과한다.
    const resource = serializeResource(AUTH_TOKENS_SERIALIZER, {
      id: 'x',
      accessToken: 'a',
      refreshToken: 'b',
      accessTokenExpiresIn: 1,
      refreshTokenExpiresAt: new Date(0),
    });
    expect(resource).not.toHaveProperty('links');
  });
});
