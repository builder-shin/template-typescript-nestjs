import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { IsNull } from 'typeorm';
import { canIdentify } from '../controllers/concerns/relationship-resolver.js';
import { JsonApiError } from '../jsonapi/errors.js';
import { RefreshSession } from '../models/refresh-session.entity.js';
import { User } from '../models/user.entity.js';
import type { EntityManager } from 'typeorm';
import type { RefreshTokenClaims, TokenService } from './tokens.js';

export interface IssuedSession {
  readonly id: string;
  readonly expiresAt: Date;
  readonly refreshToken: string;
}
export interface RotatedSession extends IssuedSession {
  readonly userId: string;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The caller owns the transaction and locks the user before issuing. */
export async function issueSession(
  manager: EntityManager,
  userId: string,
  ttlSeconds: number,
  tokens: TokenService,
): Promise<IssuedSession> {
  const id = randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  const refreshToken = tokens.signRefreshToken(userId, id, issuedAt);
  const expiresAt = new Date((issuedAt + ttlSeconds) * 1000);
  await manager.save(RefreshSession, {
    id,
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
    revokedAt: null,
    replacedById: null,
  });
  return { id, expiresAt, refreshToken };
}

export async function lockUser(manager: EntityManager, userId: string): Promise<User | null> {
  if (!canIdentify(manager, User, userId)) return null;
  return manager.findOne(User, { where: { id: userId }, lock: { mode: 'pessimistic_write' } });
}

/** Return expected errors so the caller commits security changes before raising them. */
export async function rotateSession(
  manager: EntityManager,
  rawToken: string,
  ttlSeconds: number,
  tokens: TokenService,
): Promise<RotatedSession | JsonApiError> {
  const verified = await loadVerifiedSession(manager, rawToken, tokens);
  if (verified instanceof JsonApiError) return verified;
  const { current, user } = verified;
  if (current.revokedAt !== null) {
    await manager.update(
      RefreshSession,
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return new JsonApiError('TOKEN_REVOKED');
  }
  if (!user.isActive) {
    await manager.update(RefreshSession, { id: current.id }, { revokedAt: new Date() });
    return new JsonApiError('USER_INACTIVE');
  }
  const next = await issueSession(manager, user.id, ttlSeconds, tokens);
  await manager.update(
    RefreshSession,
    { id: current.id },
    { revokedAt: new Date(), replacedById: next.id },
  );
  return { ...next, userId: user.id };
}

export async function revokeSession(
  manager: EntityManager,
  rawToken: string,
  tokens: TokenService,
): Promise<undefined | JsonApiError> {
  const verified = await loadVerifiedSession(manager, rawToken, tokens);
  if (verified instanceof JsonApiError) return verified;
  if (verified.current.revokedAt === null) {
    await manager.update(RefreshSession, { id: verified.current.id }, { revokedAt: new Date() });
  }
}

async function loadVerifiedSession(
  manager: EntityManager,
  rawToken: string,
  tokens: TokenService,
): Promise<{ current: RefreshSession; user: User } | JsonApiError> {
  let claims: RefreshTokenClaims;
  let expired = false;
  try {
    try {
      claims = tokens.verifyRefreshToken(rawToken);
    } catch (error: unknown) {
      if (!(error instanceof JsonApiError) || error.code !== 'TOKEN_EXPIRED') throw error;
      claims = tokens.verifyExpiredRefreshToken(rawToken);
      expired = true;
    }
  } catch (error: unknown) {
    if (error instanceof JsonApiError) return error;
    throw error;
  }
  // Every login/refresh/logout mutation uses this order, avoiding cross-session deadlocks.
  const user = await lockUser(manager, claims.userId);
  if (user === null || !canIdentify(manager, RefreshSession, claims.sessionId))
    return new JsonApiError('INVALID_TOKEN');
  const current = await manager.findOne(RefreshSession, {
    where: { id: claims.sessionId },
    lock: { mode: 'pessimistic_write' },
  });
  if (
    current?.userId !== user.id ||
    !/^[a-f0-9]{64}$/.test(current.tokenHash) ||
    !timingSafeEqual(
      Buffer.from(current.tokenHash, 'hex'),
      Buffer.from(hashRefreshToken(rawToken), 'hex'),
    )
  ) {
    return new JsonApiError('INVALID_TOKEN');
  }
  if (expired || current.expiresAt.getTime() <= Date.now()) {
    if (current.revokedAt === null)
      await manager.update(RefreshSession, { id: current.id }, { revokedAt: new Date() });
    return new JsonApiError('TOKEN_EXPIRED');
  }
  return { current, user };
}
