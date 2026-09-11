import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { RefreshSession } from '../../src/app/models/refresh-session.entity.js';
import { User } from '../../src/app/models/user.entity.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';

describe('인증 스키마', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('같은 이메일을 두 번 넣으면 유니크 제약이 막는다', async () => {
    // 중복 가입을 409로 옮기려면 DB가 실제로 막아야 한다. 애플리케이션의 사전 조회로만
    // 막으면 동시에 들어온 두 가입이 둘 다 통과한다.
    await withRollback(dataSource, async (manager) => {
      await manager.insert(User, { email: 'ㄱ@example.test', passwordHash: 'x' });
      await expect(
        manager.insert(User, { email: 'ㄱ@example.test', passwordHash: 'y' }),
      ).rejects.toThrow(/UQ_users_email/);
    });
  });

  it('사용자를 지우면 그 세션도 함께 사라진다', async () => {
    await withRollback(dataSource, async (manager) => {
      const user = await manager.save(User, { email: 'ㄴ@example.test', passwordHash: 'x' });
      await manager.insert(RefreshSession, {
        userId: user.id,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        replacedById: null,
      });

      await manager.delete(User, { id: user.id });

      expect(await manager.count(RefreshSession, { where: { userId: user.id } })).toBe(0);
    });
  });

  it('가리켜진 세션을 지우면 포인터가 null이 되고 옛 세션은 남는다', async () => {
    // `ON DELETE SET NULL`의 요점이다. `CASCADE`였다면 새 세션을 정리하는 순간
    // 감사 흔적인 옛 세션까지 사라진다.
    await withRollback(dataSource, async (manager) => {
      const user = await manager.save(User, { email: 'ㄷ@example.test', passwordHash: 'x' });
      const expiresAt = new Date(Date.now() + 60_000);
      const next = await manager.save(RefreshSession, {
        userId: user.id,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt,
        revokedAt: null,
        replacedById: null,
      });
      const previous = await manager.save(RefreshSession, {
        userId: user.id,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt,
        revokedAt: new Date(),
        replacedById: next.id,
      });

      await manager.delete(RefreshSession, { id: next.id });

      const reloaded = await manager.findOneByOrFail(RefreshSession, { id: previous.id });
      expect(reloaded.replacedById).toBeNull();
    });
  });

  it('없는 세션을 가리키면 거절한다', async () => {
    // FK가 장식이 아니라 실제로 걸려 있는지 본다.
    await withRollback(dataSource, async (manager) => {
      const user = await manager.save(User, { email: 'ㄹ@example.test', passwordHash: 'x' });
      await expect(
        manager.insert(RefreshSession, {
          userId: user.id,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          replacedById: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow(/FK_refresh_sessions_replaced_by/);
    });
  });
});
