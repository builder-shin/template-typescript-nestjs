import argon2 from 'argon2';

/**
 * 비밀번호 해시.
 *
 * 옵션을 손대지 않고 argon2 기본값(argon2id, m=65536, p=4, t=3)을 쓴다. 파라미터를
 * 직접 고르면 라이브러리가 권고를 올릴 때 이 파일만 뒤처진다.
 *
 * 한 번에 약 28ms 걸린다(실측). 요청 경로에서 한 번씩만 부르는 것을 전제로 한다.
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

/**
 * 비밀번호를 대조한다.
 *
 * 틀린 비밀번호는 `false`이고 예외가 아니다. 반면 해시 문자열 자체가 깨졌으면
 * `TypeError`가 그대로 올라간다 — 그것은 사용자 입력이 아니라 저장된 데이터의 손상이고,
 * "비밀번호가 틀렸다"로 위장되면 원인을 찾을 길이 없어진다.
 */
export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

/**
 * 존재하지 않는 계정에 대해서도 검증 비용을 치른다.
 *
 * 이메일이 없을 때 곧바로 돌아오면 응답 시간이 "그 계정은 없다"를 알려 준다.
 * 모듈이 로드될 때 한 번 만든 더미 해시로 같은 일을 시켜 그 차이를 지운다.
 *
 * 결과를 버리는 것이 요점이라 반환값이 없다. 시간을 완전히 같게 만들지는 못하지만
 * (해시 하나의 편차는 남는다), 계정 유무가 만드는 수십 밀리초의 계단은 사라진다.
 */
const DUMMY_HASH_PROMISE: Promise<string> = argon2.hash('존재하지 않는 계정을 위한 더미 값');

export async function verifyDummyPassword(plain: string): Promise<void> {
  await argon2.verify(await DUMMY_HASH_PROMISE, plain);
}
