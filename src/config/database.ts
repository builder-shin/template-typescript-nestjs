import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from '../app/models/index.js';
import { MIGRATIONS } from '../db/migrations/index.js';
import type { DatabaseSettings } from './settings.js';

/**
 * `DataSource` 옵션을 조립한다.
 *
 * `synchronize`는 어떤 환경에서도 `false`다. 스키마 변경은 마이그레이션으로만 전달한다 —
 * `synchronize: true`는 개발 편의를 주는 대신 마이그레이션과 실제 스키마를 조용히
 * 어긋나게 만들고, 그 차이는 배포 시점에야 드러난다.
 *
 * `migrationsRun`도 `false`다. 마이그레이션 실행 시점은 배포 절차가 정할 일이지
 * 프로세스 시작이 정할 일이 아니다.
 */
export function buildDataSourceOptions(settings: DatabaseSettings): DataSourceOptions {
  return {
    type: 'postgres',
    url: settings.url,
    entities: [...ENTITIES],
    migrations: [...MIGRATIONS],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      max: settings.poolMax,
      idleTimeoutMillis: settings.idleTimeoutMs,
      connectionTimeoutMillis: settings.connectionTimeoutMs,
    },
  };
}
