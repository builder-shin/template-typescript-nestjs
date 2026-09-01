import { Category } from './category.entity.js';
import { Example } from './example.entity.js';
import { Tag } from './tag.entity.js';

export { Category } from './category.entity.js';
export { Example, EXAMPLE_STATUSES } from './example.entity.js';
export type { ExampleStatus } from './example.entity.js';
export { Tag } from './tag.entity.js';

/**
 * DataSource에 등록하는 엔티티의 유일한 목록.
 *
 * glob 경로(`src/**\/*.entity.ts`)로 자동 탐색하지 않는다. 라우트 등록과 같은 계약이다 —
 * 이 배열에 없는 엔티티는 존재하지 않는 것과 같다. ESM + tsc 빌드에서 glob은 `src/`와
 * `dist/` 경로가 갈라지는 흔한 실패원이기도 하다.
 *
 * 타입은 TypeORM `DataSourceOptions.entities`가 요구하는 `Function`을 그대로 쓴다 —
 * TypeORM 자신의 공개 타입이 엔티티 클래스를 `Function`으로 다루므로 여기서 좁히면
 * `buildDataSourceOptions`에 넘길 때 다시 넓혀야 한다.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM의 entities 옵션 타입이 Function이다
export const ENTITIES: readonly Function[] = [Example, Category, Tag];
