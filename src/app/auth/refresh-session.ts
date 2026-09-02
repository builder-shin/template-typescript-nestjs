import { IsNull } from 'typeorm';
import { canIdentify } from '../controllers/concerns/relationship-resolver.js';
import { JsonApiError } from '../jsonapi/errors.js';
import { RefreshSession } from '../models/refresh-session.entity.js';
import type { EntityManager } from 'typeorm';

/**
 * refresh session의 수명 관리.
 *
 * **호출자가 트랜잭션을 소유한다.** `rotateSession`은 행을 `FOR UPDATE`로 잡으므로
 * 트랜잭션 밖에서 부르면 TypeORM이 거절한다. Phase 5의 `upsertRow`와 같은 계약이다 —
 * 회전은 "옛 행을 폐기하고 새 행을 만든다"는 두 쓰기라, 둘 사이에서 실패하면 폐기만
 * 되고 새 token은 없는 상태가 남는다.
 */

/** 새로 만든 세션. */
export interface IssuedSession {
  readonly id: string;
  readonly expiresAt: Date;
}

/** 회전 결과. 새 token을 서명하려면 사용자 id가 함께 필요하다. */
export interface RotatedSession extends IssuedSession {
  readonly userId: string;
}

/** 세션 하나를 만든다. */
export async function issueSession(
  manager: EntityManager,
  userId: string,
  ttlSeconds: number,
): Promise<IssuedSession> {
  const created = await manager.save(RefreshSession, {
    userId,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    revokedAt: null,
    replacedById: null,
  });
  return { id: created.id, expiresAt: created.expiresAt };
}

/**
 * 옛 세션을 폐기하고 새 세션으로 잇는다.
 *
 * 옛 행을 먼저 잠그는 이유: 같은 refresh token으로 동시에 두 번 갱신하면, 잠금이
 * 없을 때 둘 다 "폐기되지 않았다"를 보고 각자 새 세션을 만든다 — 훔친 token과 원래
 * token이 나란히 살아남는다.
 */
export async function rotateSession(
  manager: EntityManager,
  sessionId: string,
  ttlSeconds: number,
): Promise<RotatedSession> {
  const current = await lockSession(manager, sessionId);

  if (current.revokedAt !== null) {
    throw new JsonApiError('TOKEN_REVOKED');
  }
  if (current.expiresAt.getTime() <= Date.now()) {
    throw new JsonApiError('TOKEN_EXPIRED');
  }

  const next = await issueSession(manager, current.userId, ttlSeconds);
  await manager.update(
    RefreshSession,
    { id: current.id },
    { revokedAt: new Date(), replacedById: next.id },
  );
  return { ...next, userId: current.userId };
}

/**
 * 세션 하나를 폐기한다. 없거나 이미 폐기됐어도 조용히 끝난다.
 *
 * 멱등한 이유: 로그아웃이 바라는 최종 상태는 "이 세션이 못 쓰이는 것"이고, 두 번
 * 눌린 버튼은 클라이언트 오류가 아니다. `revokedAt: IsNull()` 조건으로 좁히는 것도
 * 같은 이유다 — 이미 폐기된 행의 시각을 덮어쓰면 언제 로그아웃했는지가 재시도로
 * 흔들린다.
 */
export async function revokeSession(manager: EntityManager, sessionId: string): Promise<void> {
  if (!canIdentify(manager, RefreshSession, sessionId)) {
    return;
  }
  await manager.update(
    RefreshSession,
    { id: sessionId, revokedAt: IsNull() },
    { revokedAt: new Date() },
  );
}

/**
 * 세션을 잠근 채 읽는다.
 *
 * uuid 모양을 먼저 거르는 이유: uuid 컬럼에 uuid가 아닌 문자열을 넣으면 PostgreSQL이
 * 22P02로 죽어 401이어야 할 것이 500이 된다. `sessionId`는 우리가 서명한 token에서
 * 오지만, 비밀 키를 쥔 쪽은 아무 `jti`나 실어 보낼 수 있다. Phase 4가 관계 linkage
 * id로 같은 사고를 겪고 만든 `canIdentify`를 그대로 쓴다 — 두 곳이 각자 판정하면
 * 한쪽만 고쳐지는 날이 온다.
 */
async function lockSession(manager: EntityManager, sessionId: string): Promise<RefreshSession> {
  if (!canIdentify(manager, RefreshSession, sessionId)) {
    throw new JsonApiError('INVALID_TOKEN');
  }
  const session = await manager.findOne(RefreshSession, {
    where: { id: sessionId },
    lock: { mode: 'pessimistic_write' },
  });
  if (session === null) {
    throw new JsonApiError('INVALID_TOKEN');
  }
  return session;
}
