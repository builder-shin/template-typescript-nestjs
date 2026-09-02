// `import IORedis from 'ioredis'`(default import)는 이 저장소의
// `moduleResolution: node16` + `esModuleInterop` 조합에서 `TS2351: This expression is
// not constructable`로 거부된다(실측, `pnpm exec tsc --noEmit` 재현). ioredis의
// `built/Redis.d.ts`는 `declare class Redis ... ; export default Redis;`로 선언하고
// `built/index.d.ts`는 그것을 `export { default } from './Redis'`로 재수출하는데, 이
// 재수출 형태가 이 tsconfig 조합에서 생성자 시그니처를 잃는다. named export `Redis`는
// 같은 클래스를 가리키면서 이 문제를 겪지 않으므로 그쪽을 쓴다.
import { Redis } from 'ioredis';
import { requireTestRedisUrl } from '../db/fixture.js';

describe('테스트 Redis', () => {
  it('게이트가 붙을 수 있는 Redis를 준다', async () => {
    // 이 스펙 하나가 "Task 5의 통합 테스트가 로컬에서만 도는 테스트가 아니다"를
    // 보증한다. 게이트에서 redis 서비스가 빠지면 여기서 먼저 깨진다.
    //
    // `brokerConnection`이 아니라 ioredis를 직접 쓴다 — 확인하려는 것은 우리 옵션이
    // 아니라 게이트가 실제로 붙을 수 있는 Redis를 주느냐이고, 그 둘은 다른 질문이다.
    const connection = new Redis(requireTestRedisUrl());
    try {
      await expect(connection.ping()).resolves.toBe('PONG');
    } finally {
      await connection.quit();
    }
  });
});
