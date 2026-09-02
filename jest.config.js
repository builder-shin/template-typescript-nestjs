/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/config/main.ts',
    // main.ts와 같은 이유로 제외한다 — 조건 없이 실행되는 top-level bootstrap
    // 스크립트라 import하는 순간 실제 Redis/PostgreSQL에 붙고 SIGTERM/SIGINT를
    // 등록해 버려 테스트가 import할 수 없다. 테스트 가능한 로직(잡 이름 → 핸들러
    // 분배)은 src/app/jobs/dispatch.ts로 빼서 그쪽에서 커버한다.
    '!src/app/jobs/worker.ts',
    // TypeORM CLI 전용. import 시점에 loadDatabaseSettings()를 실행하므로 단위 테스트에서
    // 불러올 수 없고, 실제 계약(buildDataSourceOptions)은 database.ts 쪽에서 검증된다.
    '!src/config/data-source.ts',
    // 등록 배열만 담은 파일. 내용은 entities.spec.ts / migration-naming.spec.ts가 고정한다.
    '!src/app/models/index.ts',
    '!src/db/migrations/index.ts',
    '!src/app/serializers/index.ts',
    '!src/app/schemas/index.ts',
  ],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
