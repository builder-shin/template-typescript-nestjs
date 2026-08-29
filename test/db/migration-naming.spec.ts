import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS } from '../../src/db/migrations/index.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations');
const FILE_PATTERN = /^(\d{14})-[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const CLASS_PATTERN = /^([A-Z][A-Za-z0-9]*?)(\d{13})$/;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .sort();
}

/** `20260829000000` → epoch millis (UTC로 해석). */
function fileTimestampToEpoch(stamp: string): number {
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const second = Number(stamp.slice(12, 14));
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

describe('마이그레이션 명명 규약', () => {
  it('마이그레이션이 하나 이상 있다', () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it('모든 파일명이 <14자리 UTC>-<kebab-name>.ts 형식이다', () => {
    for (const name of migrationFiles()) {
      expect(name).toMatch(FILE_PATTERN);
    }
  });

  it('모든 클래스명이 <PascalName><13자리 epoch millis> 형식이다', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.name).toMatch(CLASS_PATTERN);
    }
  });

  it('파일명 타임스탬프와 클래스명 타임스탬프가 같은 시각을 가리킨다', () => {
    const files = migrationFiles();
    expect(MIGRATIONS).toHaveLength(files.length);

    const classEpochs = MIGRATIONS.map((migration) => {
      const matched = CLASS_PATTERN.exec(migration.name);
      // `noUncheckedIndexedAccess` 아래에서 캡처 그룹은 `string | undefined`다.
      // 구조분해 후 명시적으로 좁힌다 — 캐스트나 `!`를 쓰지 않는다.
      const epoch = matched?.[2];
      if (epoch === undefined) {
        throw new Error(`bad migration class name: ${migration.name}`);
      }
      return Number(epoch);
    }).sort((a, b) => a - b);

    const fileEpochs = files
      .map((name) => {
        const matched = FILE_PATTERN.exec(name);
        const stamp = matched?.[1];
        if (stamp === undefined) {
          throw new Error(`bad migration file name: ${name}`);
        }
        return fileTimestampToEpoch(stamp);
      })
      .sort((a, b) => a - b);

    expect(classEpochs).toEqual(fileEpochs);
  });

  it('MIGRATIONS 배열이 디렉터리의 모든 마이그레이션을 담는다', () => {
    expect(MIGRATIONS).toHaveLength(migrationFiles().length);
  });

  it('모든 마이그레이션이 up과 down을 구현한다', () => {
    for (const migration of MIGRATIONS) {
      const proto = migration.prototype as Record<string, unknown>;
      expect(typeof proto.up).toBe('function');
      expect(typeof proto.down).toBe('function');
    }
  });
});
