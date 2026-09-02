import type { MigrationInterface } from 'typeorm';
import { AddExampleSortIndexes1788048000000 } from './20260830000000-add-example-sort-indexes.js';
import { CreateExampleSchema1787961600000 } from './20260829000000-create-example-schema.js';

/**
 * 마이그레이션 클래스.
 *
 * `Function`을 확장해 TypeORM `DataSourceOptions.migrations`가 요구하는 타입을 그대로
 * 만족시키면서, 생성자 시그니처와 `prototype`을 함께 선언한다. 그래서 호출하는 쪽이
 * 캐스트 없이 `new migration()`으로 인스턴스를 만들고 `migration.prototype.up`을 읽을 수
 * 있다 — `test/integration/migration-revert.spec.ts`가 `down()`을 실제로 실행하려면
 * 이 정도의 타입이 필요하다.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM의 migrations 옵션 타입이 Function이다
export interface MigrationClass extends Function {
  new (): MigrationInterface;
  readonly prototype: MigrationInterface;
}

/**
 * DataSource에 등록하는 마이그레이션의 유일한 목록.
 *
 * 엔티티와 같은 계약이다 — glob으로 탐색하지 않고, 이 배열에 없는 마이그레이션은
 * 실행되지 않는다. 새 마이그레이션을 만들면 파일 생성과 이 배열 추가가 한 커밋에 있어야
 * 한다. `test/db/migration-naming.spec.ts`가 디렉터리와 이 배열의 개수를 비교해 고정한다.
 *
 * 순서는 TypeORM이 클래스명 끝의 epoch millis로 정하므로 이 배열의 순서에 의존하지 않는다.
 */
export const MIGRATIONS: readonly MigrationClass[] = [
  CreateExampleSchema1787961600000,
  AddExampleSortIndexes1788048000000,
];
