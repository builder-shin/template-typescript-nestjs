import { buildDataSourceOptions } from '../../src/config/database.js';
import type { DatabaseSettings } from '../../src/config/settings.js';

const SETTINGS: DatabaseSettings = {
  url: 'postgres://user:pass@localhost:5432/app',
  poolMax: 10,
  idleTimeoutMs: 30000,
  connectionTimeoutMs: 30000,
};

describe('buildDataSourceOptions', () => {
  /**
   * `synchronize`와 `migrationsRun`은 이 저장소에서 유일하게 테스트로 고정되지 않았던
   * 계약이었다 — README 산문, 셸 스크립트 문자열, 마이그레이션 파일명 규약, 24개
   * 오류 코드는 전부 테스트가 고정하는데 이 값만 그러지 않았다. 스키마 드리프트
   * 테스트조차 `initialize()`가 이미 동기화를 끝낸 뒤에 도는 순서라, `synchronize:
   * true`로 바뀌어도 전체 게이트가 초록으로 남는다. 이 값이 뒤집히면 배포 환경의
   * 스키마를 조용히 파괴하므로, 실제 DB 없이 `buildDataSourceOptions`의 반환값만
   * 검사해 이 계약을 고정한다.
   */
  it('synchronize와 migrationsRun을 false로 고정한다', () => {
    const options = buildDataSourceOptions(SETTINGS);
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
  });

  it('postgres 드라이버를 쓴다', () => {
    expect(buildDataSourceOptions(SETTINGS).type).toBe('postgres');
  });

  it('엔티티와 마이그레이션 목록을 비워두지 않는다', () => {
    const { entities, migrations } = buildDataSourceOptions(SETTINGS);
    // `DataSourceOptions.entities`/`migrations`는 TypeORM `MixedList<T>` 타입이라
    // 배열 외에 `{ [key: string]: T }`도 허용한다. `buildDataSourceOptions`는 항상
    // 배열을 넘기지만, 그 사실을 타입이 아니라 값으로 확인한다.
    expect(Array.isArray(entities)).toBe(true);
    expect(Array.isArray(migrations)).toBe(true);
    if (Array.isArray(entities)) {
      expect(entities.length).toBeGreaterThan(0);
    }
    if (Array.isArray(migrations)) {
      expect(migrations.length).toBeGreaterThan(0);
    }
  });

  it('설정값을 URL과 커넥션 풀에 그대로 전달한다', () => {
    const options = buildDataSourceOptions(SETTINGS);
    // `DataSourceOptions`는 드라이버별 옵션의 union이라 `url`은 postgres 계열에만
    // 있다. `type`으로 좁혀야 나머지 단언에서 존재하지 않는 프로퍼티 접근이 안 된다.
    if (options.type !== 'postgres') {
      throw new Error(`postgres 드라이버를 기대했지만 ${options.type}를 받았다`);
    }
    expect(options.url).toBe(SETTINGS.url);
    expect(options.extra).toEqual({
      max: SETTINGS.poolMax,
      idleTimeoutMillis: SETTINGS.idleTimeoutMs,
      connectionTimeoutMillis: SETTINGS.connectionTimeoutMs,
    });
  });
});
