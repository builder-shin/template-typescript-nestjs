import { JOBS_QUEUE_NAME, brokerConnection } from '../../src/config/broker.js';

describe('JOBS_QUEUE_NAME', () => {
  it('기대한 큐 이름이다', () => {
    // 워커와 생산자가 같은 큐를 보는지가 이 상수 하나에 달려 있다. 오타 하나면
    // 잡이 영원히 처리되지 않는데 아무 오류도 나지 않는다.
    expect(JOBS_QUEUE_NAME).toBe('jobs');
  });
});

describe('brokerConnection', () => {
  const redisUrl = 'redis://127.0.0.1:6379';

  it('URL을 쪼개거나 재조립하지 않고 그대로 싣는다', () => {
    expect(brokerConnection(redisUrl)).toEqual({ url: redisUrl });
  });

  it('rediss:// URL도 그대로 싣는다', () => {
    // TLS 여부는 이 함수가 아니라 ioredis의 스킴 파서가 결정한다(실측,
    // phase7-probe-findings.md 9.1) — 여기서 분기할 필요가 없다.
    const tlsUrl = 'rediss://127.0.0.1:6380';
    expect(brokerConnection(tlsUrl)).toEqual({ url: tlsUrl });
  });

  it('maxRetriesPerRequest를 설정하지 않는다', () => {
    // { url } 형태로 넘기는 경로에서는 BullMQ가 Worker의 블로킹 커넥션에 한해 이
    // 값을 항상 null로 강제한다(실측, phase7-probe-findings.md 9.2) — 우리가
    // 설정할 필요가 없다. 이 단언이 없으면 누군가 조용히 필드를 추가해도 아무도
    // 모른다.
    expect(brokerConnection(redisUrl)).not.toHaveProperty('maxRetriesPerRequest');
  });
});
