import argon2 from 'argon2';
import { verifyDummyPassword } from '../../src/app/auth/password.js';
import type { HashOptions } from 'argon2';

/**
 * `verifyDummyPassword`가 실패를 영원히 캐시하지 않는지 확인한다.
 *
 * `password.spec.ts`와 별도 파일로 두는 이유: `password.ts` 최상위의
 * `dummyHashPromise` 캐시는 이 프로세스가 그 모듈을 처음 import할 때 비어 있어야
 * "첫 시도"를 실측할 수 있다. 같은 파일 안에 `verifyDummyPassword`를 먼저 부르는
 * 테스트가 있으면(순서에 따라) 이미 채워진 캐시를 보게 된다. Jest는 테스트 파일마다
 * 모듈 레지스트리를 새로 만들므로, 별도 파일이면 그 순서 걱정이 없다.
 *
 * `jest.spyOn`을 쓰지 않는 이유는 `health.controller.spec.ts`와 같다 — 이 프로젝트의
 * ESM Jest 설정은 `jest` 전역을 주입하지 않는다. `argon2.hash`가 쓰기 가능한
 * 프로퍼티이므로(실측 확인: writable/configurable, 객체도 freeze되지 않음), 인스턴스
 * 프로퍼티를 덮어쓰는 것과 같은 방식으로 직접 교체한다.
 */
describe('더미 비밀번호 캐시', () => {
  it('첫 시도가 실패해도 다음 시도는 다시 만든다', async () => {
    // promise를 캐시하는데 그 promise가 거부된 채로 남으면, 이후 모든 "없는 계정"
    // 로그인이 여기서 함께 실패해 "틀린 비밀번호" 경로와 상태 코드로 갈린다 — 그
    // 차이 자체가 계정 존재를 알려 주는 오라클이 된다.
    const original = argon2.hash;
    let calls = 0;
    argon2.hash = (async (password: string, options?: HashOptions): Promise<string> => {
      calls += 1;
      if (calls === 1) {
        throw new Error('의도한 실패');
      }
      return original(password, options);
    }) as typeof argon2.hash;

    try {
      await expect(verifyDummyPassword('무엇이든')).rejects.toThrow('의도한 실패');
      // 캐시가 비워지지 않았다면 이 두 번째 호출도 같은 거부된 promise를 다시 던진다.
      await expect(verifyDummyPassword('무엇이든')).resolves.toBeUndefined();
      expect(calls).toBe(2);
    } finally {
      argon2.hash = original;
    }
  });
});
