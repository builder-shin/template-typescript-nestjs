import { hashPassword, verifyDummyPassword, verifyPassword } from '../../src/app/auth/password.js';

// argon2 한 번이 이 기계에서 약 28ms다. 케이스마다 새로 해시하면 스위트가 눈에 띄게
// 느려지므로, 해시는 한 번만 만들어 나눠 쓴다.
describe('비밀번호 해시', () => {
  const plain = '아주-긴-비밀번호-12345';
  let hash: string;

  beforeAll(async () => {
    hash = await hashPassword(plain);
  });

  it('argon2id 해시를 만든다', () => {
    // 접두사를 고정한다. 기본 변종이 argon2i나 argon2d로 바뀌면 여기서 걸린다 —
    // 비밀번호 해시의 변종은 조용히 바뀌어도 되는 것이 아니다.
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('같은 비밀번호도 매번 다른 해시가 된다', async () => {
    // 솔트가 실제로 붙는지 본다. 같은 값이 나오면 해시가 결정적이라는 뜻이고,
    // 그러면 같은 비밀번호를 쓰는 계정들이 서로 드러난다.
    expect(await hashPassword(plain)).not.toBe(hash);
  });

  it('맞는 비밀번호를 통과시킨다', async () => {
    expect(await verifyPassword(hash, plain)).toBe(true);
  });

  it('틀린 비밀번호를 던지지 않고 거짓으로 돌려준다', async () => {
    // argon2.verify의 계약이다. 던지는 것으로 잘못 알면 호출하는 쪽이 try/catch로
    // 감싸고, 그 catch가 진짜 오류(깨진 해시)까지 삼킨다.
    expect(await verifyPassword(hash, '틀린-비밀번호-12345')).toBe(false);
  });

  it('깨진 해시는 프로그래밍 오류로 터진다', async () => {
    // 저장된 해시가 깨졌다는 것은 사용자 입력 문제가 아니라 데이터 손상이다.
    // 조용히 false로 떨어뜨리면 "비밀번호가 틀렸다"로 위장돼 원인을 못 찾는다.
    await expect(verifyPassword('해시가-아니다', plain)).rejects.toThrow(TypeError);
  });

  it('더미 검증은 아무 값이나 받고 조용히 끝난다', async () => {
    // 이메일이 없을 때도 같은 일을 시켜 응답 시간으로 계정 존재를 알아내지 못하게 한다.
    await expect(verifyDummyPassword('무엇이든')).resolves.toBeUndefined();
  });
});
