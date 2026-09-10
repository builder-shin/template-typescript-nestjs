import { ConsoleLogger, Logger } from '@nestjs/common';
import { Example } from '../../src/app/models/example.entity.js';
import { processExample } from '../../src/app/jobs/process-example.js';
import { createTestDataSource, withRollback } from '../db/fixture.js';
import type { DataSource } from 'typeorm';

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('processExample', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  /**
   * 경고를 실제로 남겼는지 본다.
   *
   * `jest.fn()`을 쓸 수 없으므로(이 프로젝트의 ESM 설정은 `jest` 전역을 주입하지 않는다)
   * Nest의 `Logger.overrideLogger`로 실제 로그를 가로챈다 — `exception-filter.spec.ts`가
   * 이미 쓰는 방식이다. 그 파일을 읽고 같은 관용구를 따르되, `finally`에서 반드시 원복한다.
   */
  async function captureWarnings(run: () => Promise<void>): Promise<string[]> {
    const warnings: string[] = [];
    Logger.overrideLogger({
      log: () => undefined,
      warn: (message: unknown, ...params: unknown[]) => {
        warnings.push([message, ...params].map((part) => String(part)).join(' '));
      },
      debug: () => undefined,
      verbose: () => undefined,
      error: () => undefined,
    });
    try {
      await run();
    } finally {
      // 정적 상태이므로 반드시 되돌린다. 다른 스펙 파일에 새어 나가는 것을 막는다.
      Logger.overrideLogger(new ConsoleLogger());
    }
    return warnings;
  }

  it('uuid가 아닌 id는 경고만 남기고 정상 종료한다', async () => {
    // 재시도해도 답이 달라지지 않는 입력이다. 던지면 BullMQ가 세 번 더 시도한다.
    await withRollback(dataSource, async (manager) => {
      const warnings = await captureWarnings(() =>
        processExample(manager, { exampleId: '아이디가-아니다' }),
      );
      expect(warnings.join('\n')).toContain('아이디가-아니다');
    });
  });

  it('없는 Example도 경고만 남기고 정상 종료한다', async () => {
    // 잡이 큐에 들어간 뒤 행이 지워지는 것은 정상적인 경합이지 오류가 아니다.
    await withRollback(dataSource, async (manager) => {
      const warnings = await captureWarnings(() =>
        processExample(manager, { exampleId: MISSING_ID }),
      );
      expect(warnings.join('\n')).toContain(MISSING_ID);
    });
  });

  it('있는 Example을 처리해도 행이 한 글자도 바뀌지 않는다', async () => {
    // 스펙 10장의 "공개 필드는 변경하지 않는다"가 이것이다. `updatedAt`까지 그대로여야
    // 한다 — 그것도 공개 표현의 일부이고, 배경 잡이 사용자에게 보이는 상태를 조용히
    // 흔들지 않는다는 것이 이 잡의 규율이다.
    await withRollback(dataSource, async (manager) => {
      const created = await manager.save(Example, {
        title: '처리 대상',
        status: 'draft',
        score: 0,
      });
      const before = await manager.findOneByOrFail(Example, { id: created.id });

      // 성공 경로도 `logger.log`를 남긴다 — captureWarnings로 감싸지 않으면 이 로그가
      // 실제 콘솔에 그대로 찍힌다(다른 테스트들과 같은 이유로 감싼다).
      const warnings = await captureWarnings(() =>
        processExample(manager, { exampleId: created.id }),
      );
      expect(warnings).toHaveLength(0);

      const after = await manager.findOneByOrFail(Example, { id: created.id });
      expect(after).toEqual(before);
    });
  });

  it('DB 오류는 삼키지 않고 그대로 던진다', async () => {
    // 일시적 DB 오류는 재시도하면 풀릴 수 있다(스펙 10장: 최대 3회). 여기서 삼키면
    // 잡이 "성공"으로 끝나고 다시 시도되지 않는다.
    //
    // 오류를 흉내 내지 않고 진짜로 만든다: 트랜잭션 안에서 실패하는 문장을 하나 돌리면
    // 그 트랜잭션이 중단 상태가 되어 이후 모든 질의가 25P02로 거절된다.
    await withRollback(dataSource, async (manager) => {
      await expect(manager.query('SELECT 1 FROM 없는테이블')).rejects.toThrow();
      await expect(processExample(manager, { exampleId: MISSING_ID })).rejects.toThrow();
    });
  });
});
