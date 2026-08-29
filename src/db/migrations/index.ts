import { CreateExampleSchema1787961600000 } from './20260829000000-create-example-schema.js';

/**
 * DataSource에 등록하는 마이그레이션의 유일한 목록.
 *
 * 엔티티와 같은 계약이다 — glob으로 탐색하지 않고, 이 배열에 없는 마이그레이션은
 * 실행되지 않는다. 새 마이그레이션을 만들면 파일 생성과 이 배열 추가가 한 커밋에 있어야
 * 한다. `test/db/migration-naming.spec.ts`가 디렉터리와 이 배열의 개수를 비교해 고정한다.
 *
 * 순서는 TypeORM이 클래스명 끝의 epoch millis로 정하므로 이 배열의 순서에 의존하지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM의 migrations 옵션 타입이 Function이다
export const MIGRATIONS: readonly Function[] = [CreateExampleSchema1787961600000];
