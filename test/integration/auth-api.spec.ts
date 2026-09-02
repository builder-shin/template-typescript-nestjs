import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Test } from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../app-factory.js';

/**
 * 인증 API의 계약을 실제 HTTP와 실제 PostgreSQL로 고정한다.
 *
 * `examples-api.spec.ts`·`examples-put.spec.ts`와 같은 규율을 따른다 — 이 스위트는
 * 행을 커밋하고, `TRUNCATE`도 조건 없는 `DELETE`도 쓰지 않는다. 이 스위트가 만든
 * 이메일 접두사(`auth-`)만 지운다.
 *
 * `acquireCommitLock`을 잡지 않는다. 이 스위트가 만지는 테이블(`users`,
 * `refresh_sessions`)에 실제로 커밋하는 다른 스위트는 `refresh-session-concurrency.spec.ts`
 * 하나뿐이고, 그 스위트는 고정된 이메일(`refresh-concurrency@example.test`) 하나만
 * 쓰고 그것만 지운다 — 이 스위트의 `auth-` 접두사와 절대 겹치지 않는다. 두 스위트 모두
 * "테이블 전체"를 단언하지 않고 각자 자기 행만 보므로, 잠금이 막아 줄 간섭이 애초에
 * 없다. 불필요하게 잡으면 병렬성만 잃는다.
 */

const VENDOR = 'application/vnd.api+json';
const PASSWORD = '충분히-긴-비밀번호-1234';

interface ErrorBody {
  errors: { code: string; status: string }[];
}
interface TokensBody {
  data: { type: string; id: string; attributes: Record<string, unknown> };
}

describe('인증 API', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;

  const api = (): ReturnType<typeof request> => request(app.getHttpServer());

  function post(path: string, type: string, attributes: Record<string, unknown>): Test {
    return api()
      .post(`/api/v1/auth/${path}`)
      .set('Accept', VENDOR)
      .set('Content-Type', VENDOR)
      .send(JSON.stringify({ data: { type, attributes } }));
  }

  const register = (email: string, password = PASSWORD): Test =>
    post('register', 'users', { email, password });
  const login = (email: string, password = PASSWORD): Test =>
    post('login', 'authCredentials', { email, password });
  const refresh = (refreshToken: string): Test =>
    post('refresh', 'refreshTokens', { refreshToken });
  const logout = (refreshToken: string): Test => post('logout', 'refreshTokens', { refreshToken });

  /**
   * `run`을 `repeats`번 실행하고 소요 시간(ms)의 중앙값을 돌려준다.
   *
   * 중앙값을 쓰는 이유: 첫 실행에는 JIT·커넥션 워밍업 같은 순서 효과가 실리기 쉽고,
   * 평균은 그 한 번의 튐에 끌려간다. 중앙값은 그 튐 하나를 무시한다.
   */
  async function medianDurationMs(run: () => Promise<unknown>, repeats: number): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < repeats; i += 1) {
      const start = Date.now();
      await run();
      samples.push(Date.now() - start);
    }
    samples.sort((a, b) => a - b);
    const mid = samples[Math.floor(samples.length / 2)];
    if (mid === undefined) {
      throw new Error('표본이 비어 있다');
    }
    return mid;
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    // 이 스위트가 만든 계정만 지운다. 조건 없는 삭제는 같은 순간 다른 워커가 커밋해 둔
    // 행까지 지운다. `refresh_sessions`는 `ON DELETE CASCADE`로 함께 사라진다.
    await dataSource.query(`DELETE FROM users WHERE email LIKE 'auth-%'`);
    await app.close();
  });

  it('가입하면 201과 users 자원을 낸다', async () => {
    const response = await register('auth-가입@example.test').expect(201);
    expect(response.body).toMatchObject({
      data: { type: 'users', attributes: { email: 'auth-가입@example.test', isActive: true } },
    });
  });

  it('가입 응답에 비밀번호 해시가 없다', async () => {
    // 시리얼라이저 단위 테스트가 이미 보지만, 실제 응답 본문으로도 고정한다 —
    // 직렬화 경로가 하나뿐인지가 이 단언의 진짜 대상이다.
    const response = await register('auth-노출@example.test').expect(201);
    expect(JSON.stringify(response.body)).not.toContain('argon2');
  });

  it('이메일 대소문자가 달라도 같은 계정이다', async () => {
    // 정규화가 스키마 한 곳에서 일어나는지 본다. 두 곳에서 하면 갈릴 수 있고,
    // 갈리면 유니크 제약으로 되돌릴 수 없는 상태가 남는다.
    await register('auth-대소문자@example.test').expect(201);
    const response = await register('AUTH-대소문자@EXAMPLE.TEST').expect(409);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('짧은 비밀번호는 422다', async () => {
    const response = await register('auth-짧은@example.test', '짧다').expect(422);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('VALIDATION_ERROR');
  });

  it('로그인하면 200과 authTokens를 낸다', async () => {
    await register('auth-로그인@example.test').expect(201);
    const response = await login('auth-로그인@example.test').expect(200);

    const body = response.body as TokensBody;
    expect(body.data.type).toBe('authTokens');
    expect(body.data.attributes.tokenType).toBe('Bearer');
    expect(typeof body.data.attributes.accessToken).toBe('string');
    expect(typeof body.data.attributes.refreshToken).toBe('string');
  });

  it('없는 계정과 틀린 비밀번호가 같은 오류를 낸다', async () => {
    // 두 답이 다르면 응답만 보고 계정 존재를 알아낼 수 있다.
    await register('auth-같은오류@example.test').expect(201);
    const wrongPassword = await login('auth-같은오류@example.test', '틀린-비밀번호-1234').expect(
      401,
    );
    const noAccount = await login('auth-없는계정@example.test').expect(401);

    expect((wrongPassword.body as ErrorBody).errors[0]?.code).toBe('INVALID_CREDENTIALS');
    expect((noAccount.body as ErrorBody).errors[0]?.code).toBe('INVALID_CREDENTIALS');
  });

  it('없는 계정도 argon2 검증 비용을 실제로 치른다', async () => {
    // 위 테스트는 응답 코드만 본다 — login()에서 `verifyDummyPassword` 호출을
    // 통째로 지워도 두 경로 모두 여전히 INVALID_CREDENTIALS를 던지므로 그대로
    // 통과한다. 그 호출의 존재 이유는 코드를 맞추는 것이 아니라 응답 **시간**을
    // 맞추는 것이라, 여기서는 시간을 직접 잰다.
    //
    // 절대 시간 하한이 아니라 두 경로의 비율로 본다 — HTTP 왕복 오버헤드가 절대
    // 시간에 그대로 실려 판별력을 갉아먹기 때문이다(그 오버헤드는 두 경로가 똑같이
    // 치르므로 비율에서는 상쇄된다). argon2 한 번은 이 기계에서 약 28ms다
    // (`password.ts`의 실측 주석). 더미 검증이 있으면 "없는 계정" 경로도 "틀린
    // 비밀번호" 경로와 같이 argon2를 한 번 치르므로 비율이 1에 가깝다. 없으면
    // "없는 계정" 경로는 조회+직렬화만 남아 훨씬 짧아진다.
    //
    // 임계값 0.3은 실측 위에 놓았다. 호출을 지우고 재면 비율이 0.12였고(없는 계정
    // 4ms 대 틀린 비밀번호 33ms), 호출이 있는 상태로 다섯 번 재면 0.65~1.00이었다.
    // 0.3은 실패 쪽 값의 약 2.5배 위, 통과 쪽 최솟값의 약 2.2배 아래라 양쪽에서
    // 비슷한 여유를 갖는다. 0.5로 두면 통과 쪽 여유가 1.3배까지 좁아져, 언젠가
    // 흔들리는 테스트가 되고 그러면 누군가 지운다.
    await register('auth-타이밍@example.test').expect(201);

    const unknownAccountMs = await medianDurationMs(
      () => login('auth-타이밍-없음@example.test').expect(401),
      3,
    );
    const wrongPasswordMs = await medianDurationMs(
      () => login('auth-타이밍@example.test', '틀린-비밀번호-1234').expect(401),
      3,
    );

    expect(unknownAccountMs).toBeGreaterThan(wrongPasswordMs * 0.3);
  });

  it('비활성 사용자는 비밀번호가 맞아야 USER_INACTIVE를 본다', async () => {
    // 순서가 뒤집히면 비밀번호를 모르는 사람이 두 오류의 차이로 계정 존재를 알아낸다.
    await register('auth-비활성@example.test').expect(201);
    await dataSource.query(`UPDATE users SET is_active = false WHERE email = $1`, [
      'auth-비활성@example.test',
    ]);

    const wrongPassword = await login('auth-비활성@example.test', '틀린-비밀번호-1234').expect(401);
    // USER_INACTIVE는 카탈로그에서 403이다(`errors.ts`) — 인증 자체는 맞았지만 허용되지
    // 않는다는 뜻이라, 자격 증명 문제(401)와 다른 상태 코드가 맞다.
    const rightPassword = await login('auth-비활성@example.test').expect(403);

    expect((wrongPassword.body as ErrorBody).errors[0]?.code).toBe('INVALID_CREDENTIALS');
    expect((rightPassword.body as ErrorBody).errors[0]?.code).toBe('USER_INACTIVE');
  });

  it('갱신하면 새 토큰이 나오고 옛 refresh 토큰은 죽는다', async () => {
    // 스펙 9장의 "refresh token 회전 시 기존 token 즉시 폐기"를 wire에서 고정한다.
    await register('auth-회전@example.test').expect(201);
    const first = (await login('auth-회전@example.test').expect(200)).body as TokensBody;
    const firstRefresh = String(first.data.attributes.refreshToken);

    const second = (await refresh(firstRefresh).expect(200)).body as TokensBody;
    expect(second.data.attributes.refreshToken).not.toBe(firstRefresh);

    const reused = await refresh(firstRefresh).expect(401);
    expect((reused.body as ErrorBody).errors[0]?.code).toBe('TOKEN_REVOKED');
  });

  it('access 토큰으로는 갱신할 수 없다', async () => {
    await register('auth-종류@example.test').expect(201);
    const tokens = (await login('auth-종류@example.test').expect(200)).body as TokensBody;

    const response = await refresh(String(tokens.data.attributes.accessToken)).expect(401);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_TOKEN');
  });

  it('로그아웃은 204이고 두 번 해도 204다', async () => {
    // 두 번 눌린 버튼은 클라이언트 오류가 아니다.
    await register('auth-로그아웃@example.test').expect(201);
    const tokens = (await login('auth-로그아웃@example.test').expect(200)).body as TokensBody;
    const refreshToken = String(tokens.data.attributes.refreshToken);

    await logout(refreshToken).expect(204);
    await logout(refreshToken).expect(204);
  });

  it('로그아웃한 세션으로는 갱신할 수 없다', async () => {
    await register('auth-폐기@example.test').expect(201);
    const tokens = (await login('auth-폐기@example.test').expect(200)).body as TokensBody;
    const refreshToken = String(tokens.data.attributes.refreshToken);

    await logout(refreshToken).expect(204);
    const response = await refresh(refreshToken).expect(401);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('TOKEN_REVOKED');
  });

  it('망가진 토큰으로 로그아웃하면 401이다', async () => {
    // 멱등한 것은 "이미 폐기됨"이지 "무엇을 폐기할지 모르겠음"이 아니다.
    const response = await logout('토큰이-아니다').expect(401);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('INVALID_TOKEN');
  });

  it('자원 타입이 다르면 409다', async () => {
    // `parseResourceInput`의 `expectedType` 검사가 이 라우트에도 걸리는지 본다.
    const response = await post('login', 'users', {
      email: 'auth-타입@example.test',
      password: PASSWORD,
    }).expect(409);
    expect((response.body as ErrorBody).errors[0]?.code).toBe('TYPE_MISMATCH');
  });
});
