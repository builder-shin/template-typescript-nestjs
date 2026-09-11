import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DataSource, EntityManager } from 'typeorm';
import { ExamplesController } from '../../src/app/controllers/api/v1/examples.controller.js';
import { Example } from '../../src/app/models/example.entity.js';
import { Tag } from '../../src/app/models/tag.entity.js';
import { acquireCommitLock, createTestDataSource } from '../db/fixture.js';
import type { CommitLockHandle } from '../db/fixture.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface MutableController {
  findOne(
    manager: EntityManager,
    id: string,
    include: readonly string[],
    lock?: boolean,
  ): Promise<Example>;
  addToRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  removeFromRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  replaceRelationshipFor(name: string, id: string, body: unknown): Promise<void>;
  update(id: string, body: unknown): Promise<unknown>;
}

describe('relationship mutations serialize before hydrating associations', () => {
  let database: DataSource;
  let commitLock: CommitLockHandle | undefined;
  beforeAll(async () => {
    database = await createTestDataSource();
    commitLock = await acquireCommitLock(database);
  });
  afterAll(async () => {
    try {
      await commitLock?.release();
    } finally {
      await database.destroy();
    }
  });

  it.each(['add/add', 'remove/remove', 'replace/add', 'patch/add'] as const)(
    '%s preserves the previously committed association changes',
    async (scenario) => {
      const id = randomUUID();
      const firstTag = await database.manager.save(
        Tag,
        database.manager.create(Tag, { name: randomUUID() }),
      );
      const secondTag = await database.manager.save(
        Tag,
        database.manager.create(Tag, { name: randomUUID() }),
      );
      await database.manager.save(
        Example,
        database.manager.create(Example, {
          id,
          title: 'concurrent parent',
          status: 'draft',
          score: 42,
          tags: scenario === 'remove/remove' ? [firstTag, secondTag] : [],
        }),
      );
      const controller = new ExamplesController(database) as unknown as MutableController;
      const originalFind = controller.findOne.bind(controller);
      const firstRead = deferred();
      const secondRead = deferred();
      const releaseFirst = deferred();
      const releaseSecond = deferred();
      let reads = 0;
      // Pause after hydration. Before the fix both requests can hold stale collections;
      // after the fix the second request waits in PostgreSQL before it can hydrate.
      controller.findOne = async (...args): Promise<Example> => {
        const entity = await originalFind(...args);
        if (args[0].queryRunner?.isTransactionActive !== true) return entity;
        const ordinal = ++reads;
        if (ordinal === 1) {
          firstRead.resolve();
          await releaseFirst.promise;
        }
        if (ordinal === 2) {
          secondRead.resolve();
          await releaseSecond.promise;
        }
        return entity;
      };
      const body = (tag: Tag): unknown => ({ data: [{ type: 'exampleTags', id: tag.id }] });
      const first =
        scenario === 'remove/remove'
          ? controller.removeFromRelationshipFor('tags', id, body(firstTag))
          : scenario === 'replace/add'
            ? controller.replaceRelationshipFor('tags', id, body(firstTag))
            : scenario === 'patch/add'
              ? controller.update(id, {
                  data: { type: 'examples', id, attributes: { title: 'patched' } },
                })
              : controller.addToRelationshipFor('tags', id, body(firstTag));
      let second: Promise<unknown> | undefined;
      try {
        await firstRead.promise;
        second =
          scenario === 'remove/remove'
            ? controller.removeFromRelationshipFor('tags', id, body(secondTag))
            : controller.addToRelationshipFor('tags', id, body(secondTag));
        const blocked = async (): Promise<void> => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            if (reads >= 2) return;
            const rows: { waiting: boolean }[] = await database.query(
              `SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database()
               AND wait_event_type='Lock' AND query LIKE '%examples%') AS waiting`,
            );
            if (rows[0]?.waiting) return;
            await delay(10);
          }
          throw new Error('second mutation neither read nor waited on the parent lock');
        };
        await Promise.race([secondRead.promise, blocked()]);
        if (scenario === 'patch/add' && reads === 2) {
          releaseSecond.resolve();
          await second;
        }
        releaseFirst.resolve();
        await first;
        releaseSecond.resolve();
        await second;
        const persisted = await database.manager.findOneOrFail(Example, {
          where: { id },
          relations: { tags: true },
        });
        const expected =
          scenario === 'remove/remove'
            ? []
            : scenario === 'patch/add'
              ? [secondTag.id]
              : [firstTag.id, secondTag.id];
        expect((persisted.tags ?? []).map((tag) => tag.id).sort()).toEqual(expected.sort());
        if (scenario === 'patch/add') expect(persisted.title).toBe('patched');
      } finally {
        releaseFirst.resolve();
        releaseSecond.resolve();
        await Promise.allSettled([first, ...(second === undefined ? [] : [second])]);
        await database.manager.delete(Example, id);
        await database.manager.delete(Tag, [firstTag.id, secondTag.id]);
      }
    },
    15000,
  );
});
