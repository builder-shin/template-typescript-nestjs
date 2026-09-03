import type { ConnectionOptions } from 'bullmq';

/**
 * Redis/BullMQ 연결 설정 (스펙 3장).
 *
 * **왜 `@nestjs/bullmq`가 아닌가(실측):** `AppModule`의 provider 그래프 어딘가에 Bull
 * 등록을 넣으면, `test/app-factory.ts`가 `AppModule`을 통째로 import하는 탓에 job과
 * 전혀 무관한 스펙까지 포함해 스위트 전체가 Redis를 요구하게 된다 — 실제로 그렇게
 * 만들어 실행했더니 무관한 스펙 하나에서 11개 중 10개 테스트가 즉시 깨졌다
 * (`.superpowers/sdd/phase7-probe-findings.md` 3번 항목). 순수 `bullmq` + 독립 워커
 * 스크립트로 가면 이 위험이 구조적으로 없다.
 *
 * **이 파일을 `src/config/app.module.ts`(또는 그 그래프가 닿는 어디든)에서 import하면
 * 위 계약이 깨진다.** API 프로세스는 Redis 없이 떠야 하므로, 이 파일은 워커 진입점만
 * import한다.
 */

/**
 * 모든 BullMQ 잡이 공유하는 큐 이름.
 *
 * 생산자(enqueue하는 쪽)와 워커(소비하는 쪽)가 반드시 같은 문자열을 봐야 한다 — 상수
 * 하나로 묶어 두지 않으면 오타 하나로 두 쪽이 서로 다른 큐를 보게 되는데, 그 상태는
 * 예외를 던지지 않는다. 잡이 그냥 영원히 처리되지 않을 뿐이라 진단하기 어렵다.
 */
export const JOBS_QUEUE_NAME = 'jobs';

/**
 * BullMQ에 넘길 Redis 연결 옵션을 만든다.
 *
 * **인스턴스가 아니라 옵션을 돌려준다.** `{ connection: { url } }` 형태로 넘기면
 * bullmq가 내부에서 `new IORedis(url, rest)`로 커넥션을 직접 만들고(실측,
 * `RedisConnection.init()` 소스 그대로), `worker.close()`/`queue.close()`가 그
 * 커넥션까지 함께 닫는다 — 우리가 따로 들고 있다가 `quit()`할 대상이 없다. 반대로
 * 이미 만들어진 ioredis 인스턴스를 넘기면 bullmq는 그것을 "공유"로 취급해 자기가
 * 만들지 않은 커넥션을 닫지 않으므로, 그 경우엔 호출자가 직접 정리해야 한다
 * (`.superpowers/sdd/phase7-probe-findings.md` 9.1). 이 함수는 옵션만 돌려줘서 그
 * 책임 분기 자체를 피한다.
 *
 * **`maxRetriesPerRequest`를 일부러 설정하지 않는다.** 실측(위 findings 9.2, bullmq
 * 6.3.4 소스 `classes/redis-connection.js` 직접 확인 포함)으로 확인한 규칙:
 * - bullmq가 이 옵션 객체로 커넥션을 직접 만드는 경로에서는, Worker의 블로킹
 *   커넥션(`BZPOPMIN` 등)에 한해 bullmq가 커넥션 수명 내내 이 값을 `null`로 강제
 *   한다 — 우리가 설정하든 안 하든 결과가 같다. 다른 값을 명시하면 `console.error`로
 *   경고만 찍고(막지 않음) 그대로 override한다.
 * - Queue(생산자)의 비블로킹 커넥션에는 이 요구 자체가 없다.
 * - **던지는 경우는 호출자가 이미 만들어 둔 ioredis 인스턴스를 `null`이 아닌 채로
 *   넘길 때뿐이다.** 이 함수가 인스턴스가 아니라 옵션을 돌려주기로 한 결정이 그
 *   경우를 구조적으로 없앤다 — 그래서 이 필드를 아예 안 쓰는 것이 가장 단순하고
 *   실측상 완전히 안전하다.
 *
 * **`rediss://`(TLS)도 같은 경로로 동작한다.** bullmq는 `url` 문자열을 그대로
 * ioredis에 넘길 뿐이고, TLS 여부는 ioredis 자신의 URL 파서가 스킴을 보고 결정한다
 * (실측: `rediss://` → `options.tls === true`, `redis://` → `options.tls === undefined`).
 * 그래서 여기서 스킴별로 분기할 필요가 없다.
 */
export function brokerConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl };
}
