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
    // TypeORM CLI 전용. import 시점에 loadDatabaseSettings()를 실행하므로 단위 테스트에서
    // 불러올 수 없고, 실제 계약(buildDataSourceOptions)은 database.ts 쪽에서 검증된다.
    '!src/config/data-source.ts',
    // 등록 배열만 담은 파일. 내용은 entities.spec.ts / migration-naming.spec.ts가 고정한다.
    '!src/app/models/index.ts',
    '!src/db/migrations/index.ts',
    '!src/app/serializers/index.ts',
  ],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
