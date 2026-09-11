import { Logger } from '@nestjs/common';
import { normalizeUuid } from '../jsonapi/scalar-grammar.js';
import { Example } from '../models/example.entity.js';
import type { EntityManager } from 'typeorm';

/**
 * 클래스가 아니라 함수이므로 인스턴스 로거를 둘 자리가 없다. `exception-filter.ts`·
 * `health.controller.ts`와 같은 `new Logger(name)` 모양을 모듈 스코프에 그대로 옮긴다 —
 * `Logger`의 `localInstance`는 호출마다 정적 참조를 다시 읽으므로, 테스트가
 * `Logger.overrideLogger`로 가로채는 시점이 이 상수 생성보다 나중이어도 문제없다.
 */
const logger = new Logger('processExample');

/** `processExample`이 받는 잡 페이로드. */
export interface ProcessExamplePayload {
  readonly exampleId: string;
}

/**
 * Example 하나를 처리한다.
 *
 * CRUD가 이 잡을 자동으로 넣지 않는다(스펙 10장). 도메인 지점에서 명시적으로 부른다 —
 * 자동 enqueue는 "쓰기 한 번이 잡 하나"라는 숨은 결합을 만들고, 그 결합은 대량 갱신
 * 한 번에 큐를 채운다.
 *
 * **이 잡은 아무것도 쓰지 않는다.** 스펙 10장이 "공개 필드는 변경하지 않는다"고 정하는데
 * `Example`의 공개 표현에는 `updatedAt`까지 들어 있으므로, 실질적으로 이 행을 쓰지
 * 않는다는 뜻이다. 배경 잡이 사용자에게 보이는 상태를 조용히 흔들지 않는다는 규율이고,
 * 이 템플릿을 베껴 쓰는 사람이 여기에 쓰기를 더한다면 그 규율을 깨는 것이 의도인지
 * 먼저 정해야 한다.
 *
 * 재시도 정책은 이 함수가 무엇을 던지느냐로 표현된다. 재시도해도 답이 달라지지 않는
 * 입력(가리킬 수 없는 id, 사라진 행)은 경고를 남기고 **정상 반환**한다 — 던지면
 * BullMQ가 같은 답을 세 번 더 받아 낸다. 반대로 DB 오류는 그대로 던져 재시도에 맡긴다.
 */
export async function processExample(manager: EntityManager, payload: unknown): Promise<void> {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    !('exampleId' in payload)
  ) {
    logger.warn('Malformed Example job payload; skipping without retry');
    return;
  }
  const { exampleId } = payload;

  // uuid 모양을 먼저 거른다 — uuid 컬럼에 uuid가 아닌 문자열을 넣으면 22P02로 죽고,
  // 그러면 "경고 후 종료"여야 할 것이 재시도 대상 오류가 된다.
  let normalizedId: string;
  try {
    if (typeof exampleId !== 'string') throw new Error('Expected a UUID string');
    normalizedId = normalizeUuid(exampleId);
  } catch {
    logger.warn(`Example을 가리킬 수 없는 id다(id=${String(exampleId)}) — 재시도 없이 건너뛴다`);
    return;
  }

  const example = await manager.findOneBy(Example, { id: normalizedId });
  if (example === null) {
    // 잡이 큐에 들어간 뒤 행이 지워지는 것은 정상적인 경합이지 오류가 아니다.
    logger.warn(`Example을 찾을 수 없다(id=${exampleId}) — 재시도 없이 건너뛴다`);
    return;
  }

  // 여기서 더 이상 아무것도 쓰지 않는다. 위 docstring 참고 — 공개 표현에 `updatedAt`이
  // 있는 한, 이 행을 건드리는 순간 "배경 잡이 보이는 상태를 조용히 흔들지 않는다"는
  // 규율이 깨진다.
  logger.log(`Example을 처리했다(id=${exampleId})`);
}
