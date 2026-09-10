import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.js';
import { loadDatabaseSettings } from './settings.js';

/**
 * TypeORM CLI 전용 `DataSource`.
 *
 * `typeorm migration:run`은 이 파일을 직접 import해 default export를 읽는다.
 * 애플리케이션은 이 인스턴스를 쓰지 않는다 — Nest가 `TypeOrmModule`로 자기 것을 만든다.
 * 두 경로가 같은 `buildDataSourceOptions`를 지나므로 설정이 갈라지지 않는다.
 */
export default new DataSource(buildDataSourceOptions(loadDatabaseSettings()));
