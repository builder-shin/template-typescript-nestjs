# Phase 0 — 기반과 검증 게이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부팅되는 NestJS 12 ESM 애플리케이션과, 실제 Docker PostgreSQL을 띄웠다 정리하는 단일 검증 게이트를 만든다.

**Architecture:** `src/app`(도메인) · `src/config`(조립점) · `src/db`(스키마) 삼분 구조를 세우고, Phase 0에서는 조립점과 `health` 컨트롤러까지만 채운다. 라우트는 `RoutesModule`의 `controllers` 배열 한 곳에서만 등록한다. 모든 정적 검사·테스트는 `scripts/check.sh` 하나를 거치며 CI도 같은 스크립트를 호출한다.

**Tech Stack:** Node 24 / TypeScript 6.0.3 / ESM / NestJS 12.0.1 + platform-express / Jest 30.5 + ts-jest 29 + supertest 7 / ESLint 10.9 + typescript-eslint 8.68 + Prettier 3.9 / secretlint 13 / husky 9 + lint-staged 17 / pnpm 11

**Spec:** `docs/superpowers/specs/2026-08-28-nestjs-jsonapi-template-design.md`

## Global Constraints

이 절의 값은 스펙에서 그대로 옮긴 것이다. 모든 태스크의 요구사항에 암묵적으로 포함된다.

- Node `>=24.11.0`. `package.json`의 `engines.node`에 이 값을 그대로 쓴다.
- TypeScript는 **6.0.3에 고정**한다. 7.x는 네이티브 컴파일러라 JS 컴파일러 API를 노출하지 않아 `ts-jest@29`(peer `>=4.3 <7`)와 `typescript-eslint@8.68`(peer `>=4.8.4 <6.1.0`)이 동작하지 않는다.
- 패키지는 **ESM**이다. `package.json`에 `"type": "module"`을 둔다. NestJS 12는 `"type": "module"` 전용이며 CJS 빌드가 없다.
- `tsconfig`는 `module: "node18"`, `moduleResolution: "node16"`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `isolatedModules: true`, `strict: true`를 반드시 포함한다.
- **모든 상대 import에 `.js` 확장자를 붙인다.** 빠뜨리면 `tsc`가 `TS2835`로 거부한다. 별도 ESLint 규칙을 추가하지 않는다.
- Jest는 ESM이므로 `node --experimental-vm-modules node_modules/jest/bin/jest.js`로 실행한다. 이 경로 형태는 Windows/Linux 모두에서 동작하므로 `cross-env`를 추가하지 않는다.
- 커버리지 게이트는 80%다.
- **배포된 지 24시간이 지나지 않은 패키지 버전을 고정하지 않는다.** pnpm 11에는 기본 `minimumReleaseAge` 공급망 게이트가 있어서, 갓 배포된 버전이 lockfile에 들어가면 `pnpm install --frozen-lockfile`이 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`으로 거부한다. 예외 목록(`minimumReleaseAgeExclude`)을 커밋해 우회하지 말고, 숙성된 버전을 고른다. 남이 복제할 템플릿이 공급망 보호 우회를 기본값으로 배포하게 두지 않는다. 이 규칙 때문에 jest는 `30.4.2`(30.5.0 아님), `@nestjs/swagger`는 `12.0.0`(12.0.1 아님)으로 고정한다.
- 컨트롤러 자동 탐색을 추가하지 않는다. `RoutesModule`의 `controllers` 배열에 없는 컨트롤러는 존재하지 않는 것과 같다.
- 애플리케이션 코드에 환경 변수의 암묵적 기본값을 두지 않는다. 누락 시 변수 이름이 담긴 오류(`PORT must be an integer`)로 실패한다.
- 커밋 메시지에 AI 관련 태그(`Co-Authored-By: Claude` 등)를 넣지 않는다.
- `check`를 제외한 모든 npm script는 bash 없이 Windows에서 동작해야 한다.

## File Structure

| 파일 | 책임 |
| --- | --- |
| `package.json` | 의존성, script, `engines`, `lint-staged` 설정 |
| `tsconfig.json` | 타입 검사 설정 (`src` + `test`, `noEmit`) |
| `tsconfig.build.json` | 빌드 설정 (`src`만, `dist` 출력) |
| `eslint.config.js` | ESLint flat config |
| `.prettierrc.json` / `.prettierignore` | 포맷 규칙 |
| `jest.config.js` | Jest ESM 하네스와 커버리지 게이트 |
| `.secretlintrc.json` | 비밀 탐지 규칙 |
| `.husky/pre-commit` | 커밋 훅 |
| `.gitignore` / `.dockerignore` / `.env.example` | 저장소·이미지·환경 경계 |
| `.gitattributes` | 줄바꿈을 LF로 고정 (Windows clone 방어) |
| `Dockerfile` | builder / runtime 2단계 이미지 |
| `docker-compose.yml` / `docker-compose.test.yml` | 개발 스택 / 테스트 전용 PostgreSQL |
| `scripts/check.sh` | 단일 검증 게이트 |
| `.github/workflows/ci.yml` | CI |
| `README.md` | 실행과 검증 |
| `src/app/jsonapi/media-type.ts` | JSON:API vendor 미디어 타입 상수 |
| `src/app/controllers/health.controller.ts` | `/health/live`, `/health/ready` |
| `src/config/settings.ts` | 환경 변수 파싱 프리미티브와 `ServerSettings` |
| `src/config/openapi.ts` | OpenAPI 문서 설정 |
| `src/config/routes.module.ts` | 공개 라우트의 유일한 등록 지점 |
| `src/config/app.module.ts` | 애플리케이션 루트 모듈 |
| `src/config/main.ts` | 프로세스 진입점 |
| `test/setup.ts` | `reflect-metadata` 로드 |
| `test/app-factory.ts` | 테스트 애플리케이션 조립 (유일한 조립점) |
| `test/jsonapi/media-type.spec.ts` | 미디어 타입 상수 회귀 |
| `test/config/settings.spec.ts` | 환경 변수 파싱 계약 |
| `test/config/routes.module.spec.ts` | 명시 조립 라우트 집합 고정 |
| `test/health.controller.spec.ts` | health 엔드포인트 wire 응답 |
| `test/config/openapi.spec.ts` | OpenAPI 문서 노출 |
| `test/scripts/check-script.spec.ts` | `check.sh`의 검증·정리 계약 |
| `test/docs/readme.spec.ts` | README 검증 명령 동기화 |

---

### Task 1: 프로젝트 스캐폴딩과 TypeScript 6 ESM 툴체인

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `.gitignore`
- Create: `src/app/jsonapi/media-type.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `JSONAPI_MEDIA_TYPE: string` (`src/app/jsonapi/media-type.ts`에서 export). npm script `build`(`tsc -p tsconfig.build.json`), `typecheck`(`tsc --noEmit -p tsconfig.json`)

- [ ] **Step 1: `package.json` 작성**

```json
{
  "name": "template-typescript-nestjs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "description": "Production-ready NestJS JSON:API template",
  "engines": {
    "node": ">=24.11.0"
  },
  "packageManager": "pnpm@11.22.0",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "start": "node dist/config/main.js"
  },
  "devDependencies": {
    "@types/node": "24.13.3",
    "typescript": "6.0.3"
  }
}
```

`@types/node`의 메이저는 `engines.node`의 하한과 같은 계열이어야 한다. 26.x로 타입 검사하면 Node 25/26 전용 API가 `typecheck`를 통과하면서 선언한 최소 런타임(24.11)에서는 크래시한다. Docker 베이스도 `node:24-slim`이다. Node 하한을 올릴 때는 이 값도 함께 올린다.

- [ ] **Step 2: `tsconfig.json` 작성 (타입 검사용, `src` + `test`)**

`noEmit: true`이므로 `rootDir`을 지정하지 않는다. 빌드는 `tsconfig.build.json`이 담당한다.

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "node18",
    "moduleResolution": "node16",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "isolatedModules": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: `tsconfig.build.json` 작성 (빌드용, `src`만)**

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*.ts"]
}
```

`types`를 다시 좁히는 이유는 Task 2가 루트 `tsconfig.json`의 `types`에 `"jest"`를 더하기 때문이다. 그대로 상속하면 `pnpm build`가 `src/`를 jest 전역(`describe`, `jest.fn()` 등)이 보이는 상태로 검사한다. jest는 프로덕션 의존성이 아니므로, 그런 코드는 타입 검사를 통과하고 런타임에 죽는다. 빌드 설정은 빌드에 필요한 것만 본다.

- [ ] **Step 4: `.gitignore`와 `.gitattributes` 작성**

`.gitattributes`가 없으면 `core.autocrlf=true`인 Windows에서 새로 clone할 때 모든 텍스트 파일이 CRLF로 체크아웃된다. Prettier 3의 기본 `endOfLine`이 `"lf"`라 `pnpm format:check`가 `.json`·`.yml`·`.js` 전반에서 실패하고, 그것을 포함하는 `scripts/check.sh` 게이트가 **첫 실행에서 깨진다.** 실제 clone으로 재현한 결과다.

확장자별로 나열하지 않고 전체(`*`)에 적용하는 이유는 새 파일 형식이 추가될 때마다 같은 문제가 재발하기 때문이다.

```gitattributes
* text=auto eol=lf
```


```gitignore
node_modules/
dist/
coverage/
.env
*.log
.coverage*

# 계획 실행용 스크래치 워크스페이스 (ledger, 브리프, 리뷰 패키지)
.superpowers/
```

- [ ] **Step 5: 첫 소스 파일 작성**

`src/app/jsonapi/media-type.ts`:

```ts
/**
 * JSON:API 1.1 vendor 미디어 타입.
 *
 * 모든 리소스 라우트의 `Accept` 협상과 쓰기 요청의 `Content-Type` 검증이 이 값을 기준으로 한다.
 * `health` 컨트롤러는 협상 대상이 아니므로 이 값을 쓰지 않는다.
 */
export const JSONAPI_MEDIA_TYPE = 'application/vnd.api+json';
```

- [ ] **Step 6: 의존성 설치**

Run: `pnpm install`
Expected: `node_modules/`와 `pnpm-lock.yaml` 생성, 오류 없음

- [ ] **Step 7: 타입 검사와 빌드 실행**

Run: `pnpm typecheck && pnpm build`
Expected: 두 명령 모두 출력 없이 종료 코드 0. `dist/app/jsonapi/media-type.js` 파일이 생성됨

- [ ] **Step 8: `.js` 확장자 강제가 실제로 걸리는지 1회 확인**

임시 파일 `src/app/jsonapi/extension-probe.ts`를 만든다.

```ts
import { JSONAPI_MEDIA_TYPE } from './media-type';

export const probe = JSONAPI_MEDIA_TYPE;
```

Run: `pnpm typecheck`
Expected: FAIL — `src/app/jsonapi/extension-probe.ts(1,36): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './media-type.js'?`

목적은 `typecheck`가 ESM 확장자 규칙의 게이트임을 실행으로 확인하는 것이다. 이 파일은 커밋하지 않는다.

- [ ] **Step 9: 임시 파일 삭제 후 재검사**

Run: `rm src/app/jsonapi/extension-probe.ts && pnpm typecheck && pnpm build`
Expected: PASS (출력 없이 종료 코드 0)

- [ ] **Step 10: 커밋**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json .gitignore src/app/jsonapi/media-type.ts
git commit -m "chore: TypeScript 6 ESM 툴체인 스캐폴딩

NestJS 12가 type:module 전용이므로 패키지를 ESM으로 구성한다.
TypeScript는 6.0.3에 고정한다. 7.x는 네이티브 컴파일러라 ts-jest와
typescript-eslint가 요구하는 JS 컴파일러 API를 노출하지 않는다."
```

---

### Task 2: Jest ESM 테스트 하네스

**Files:**
- Modify: `package.json` (devDependencies, `test` script)
- Modify: `tsconfig.json` (`types`에 `"jest"` 추가)
- Create: `jest.config.js`
- Create: `pnpm-workspace.yaml`
- Create: `test/setup.ts`
- Create: `test/jsonapi/media-type.spec.ts`

두 파일은 Task 1 작성 시점에 예상하지 못한 것이다.

- `tsconfig.json`의 `types`는 **허용 목록**이라, `@types/jest`를 설치해도 `["node"]`인 채로는 `describe`·`it`·`expect` 전역이 배제되어 `pnpm typecheck`가 `TS2593`/`TS2304`로 깨진다. `["node", "jest"]`로 바꾼다. `pnpm test`는 ts-jest가 별도로 처리하므로 이 회귀는 `typecheck`에서만 드러난다.
- pnpm 11은 의존성의 빌드 스크립트를 기본 차단하고 `ERR_PNPM_IGNORED_BUILDS`로 exit 1을 낸다. `pnpm run test`가 내부적으로 install 상태를 확인하므로 Jest가 아예 실행되지 않는다. `pnpm-workspace.yaml`에 `allowBuilds`를 명시해 커밋해야 새로 clone한 사람과 CI가 같은 벽에 부딪히지 않는다.

`pnpm-workspace.yaml`은 `allowBuilds`와 `overrides`만 담는다. `minimumReleaseAgeExclude`를 넣지 않는다.

```yaml
allowBuilds:
  '@parcel/watcher': false
  '@scarf/scarf': false
  unrs-resolver: false
overrides:
  '@jest/transform': ~30.4.0
  '@jest/types': ~30.4.0
  babel-jest: ~30.4.0
  jest-util: ~30.4.0
```

세 항목 모두 `false`, 즉 **빌드 스크립트 실행을 거부**한다. `@parcel/watcher`와 `unrs-resolver`는 네이티브 최적화용 선택 의존성이라 거부해도 JS 폴백으로 동작한다. `@scarf/scarf`는 Task 6이 `@nestjs/swagger` → `swagger-ui-dist`를 통해 끌어오는 **설치 시점 텔레메트리**로, `postinstall`이 설치 통계를 외부(scarf.sh)로 전송한다. Swagger UI 자산 제공에는 불필요하고, 이 템플릿을 복제한 모든 소비자의 CI와 개발 머신이 같은 호출을 하게 되므로 차단한다.

`overrides`가 `package.json`의 `pnpm` 필드가 아니라 이 파일에 있는 이유는 pnpm 11이 `package.json`의 `pnpm` 필드를 무시하고 경고를 내기 때문이다.

`overrides`가 필요한 이유: `ts-jest`는 `@jest/transform`·`@jest/types`·`babel-jest`·`jest-util`을 `^29.0.0 || ^30.0.0`이라는 넓은 **optional peer**로 선언한다. pnpm은 이를 우리가 고정한 `jest` 버전과 **무관하게** 레지스트리 최신 30.x로 독립 해결하므로, `babel-jest`가 30.4.1(jest 트리 경유)과 30.5.0(ts-jest peer 경유) 두 인스턴스로 갈라진다. 갓 배포된 쪽이 `minimumReleaseAge` 게이트에 걸리는 것은 그 증상일 뿐이고, 한 트리에 같은 패키지가 두 버전으로 존재하는 것 자체가 고쳐야 할 문제다. `jest` 고정 버전을 올릴 때 이 네 줄도 같은 라인으로 함께 올린다.

pnpm 11에는 기본 `minimumReleaseAge`(약 24시간) 공급망 게이트가 있어서, 방금 배포된 패키지를 lockfile에 담으면 `pnpm install --frozen-lockfile`이 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`으로 거부한다. 이를 우회하는 예외 목록을 커밋하는 대신 **게이트를 통과하는 버전을 고른다.** 그래서 jest는 `latest`(30.5.0, 2026-08-28 배포)가 아니라 충분히 숙성된 `30.4.2`(2026-05-09 배포)로 고정한다. 예외 목록은 시점 의존적이라 버전을 올릴 때마다 재생성해야 하고, 무엇보다 남이 복제할 템플릿이 공급망 보호 우회를 기본값으로 배포하게 된다.

의존성을 올릴 때는 이 규칙을 지킨다: **배포된 지 하루가 지나지 않은 버전은 고정하지 않는다.**

**Interfaces:**
- Consumes: `JSONAPI_MEDIA_TYPE` (Task 1)
- Produces: npm script `test`(커버리지 포함), `test:cov-off`. `test/setup.ts`가 모든 테스트 전에 `reflect-metadata`를 로드한다

- [ ] **Step 1: 테스트 의존성 설치**

Run:

```bash
pnpm add -D jest@30.4.2 ts-jest@29.4.12 @types/jest@30.0.0
pnpm add reflect-metadata@0.2.2
```

Expected: 설치 성공. `ts-jest`가 `typescript` peer를 만족한다는 경고 없음 (TS 6.0.3은 `>=4.3 <7` 범위 안)

- [ ] **Step 2: 실패하는 테스트 작성**

`test/jsonapi/media-type.spec.ts`:

```ts
import { JSONAPI_MEDIA_TYPE } from '../../src/app/jsonapi/media-type.js';

describe('JSONAPI_MEDIA_TYPE', () => {
  it('JSON:API 1.1 vendor 미디어 타입이다', () => {
    expect(JSONAPI_MEDIA_TYPE).toBe('application/vnd.api+json');
  });
});
```

`test/setup.ts`:

```ts
import 'reflect-metadata';
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js`
Expected: FAIL — 설정이 없어 TypeScript 변환기가 붙지 않으므로 `SyntaxError` 계열로 실패한다(`Jest failed to parse a file` 또는 `Cannot use import statement outside a module`). Jest 기본 `testMatch`는 `*.spec.ts`를 찾지만 `.ts`를 변환할 방법이 없기 때문이다

- [ ] **Step 4: `jest.config.js` 작성**

`moduleNameMapper`는 소스가 쓰는 `./x.js` 상대 경로를 `.ts` 원본으로 되돌린다. ESM 규칙상 소스에는 `.js`를 써야 하지만 Jest가 변환하는 대상은 `.ts` 파일이기 때문이다.

```js
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
  collectCoverageFrom: ['src/**/*.ts', '!src/config/main.ts'],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
```

- [ ] **Step 5: `package.json`에 test script 추가**

`scripts`에 아래 두 줄을 더한다.

```json
"test": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage",
"test:quick": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage=false"
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — `Tests: 1 passed`. `ExperimentalWarning: VM Modules` 경고는 정상이다. 커버리지 표가 출력되고 게이트를 통과한다

- [ ] **Step 7: 커밋**

```bash
git add package.json pnpm-lock.yaml jest.config.js test/setup.ts test/jsonapi/media-type.spec.ts
git commit -m "test: Jest ESM 하네스 구성

NestJS 12가 ESM이므로 Jest도 --experimental-vm-modules로 구동한다.
실행 경로를 node_modules/jest/bin/jest.js로 직접 지정해 Windows에서도
cross-env 없이 동작하게 한다."
```

---

### Task 3: ESLint와 Prettier

**Files:**
- Modify: `package.json` (devDependencies, script)
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`

**Interfaces:**
- Consumes: `tsconfig.json` (Task 1)
- Produces: npm script `lint`, `format`, `format:check`

- [ ] **Step 1: 린트 의존성 설치**

Run:

```bash
pnpm add -D eslint@10.9.1 @eslint/js@10.0.1 typescript-eslint@8.68.0 prettier@3.9.6 eslint-config-prettier@10.1.8
```

Expected: 설치 성공

- [ ] **Step 2: `eslint.config.js` 작성**

`.js` 설정 파일들은 `tsconfig.json`의 `include`에 없으므로 타입 인식 규칙을 끈다. 그렇지 않으면 `projectService`가 해당 파일을 프로젝트에서 찾지 못해 실패한다.

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `allowExpressions`가 없으면 Jest의 `it('...', () => {})` 콜백마다 반환 타입을
      // 요구해 테스트가 전부 린트 오류가 된다. 함수 선언에만 반환 타입을 강제한다.
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // NestJS의 @Module()/@Controller() 선언은 본체가 빈 클래스다. 프레임워크의
      // 선언 문법이지 쓸데없는 클래스가 아니므로 데코레이터가 붙은 경우만 허용한다.
      // 이 줄이 없으면 Task 5의 RoutesModule·AppModule부터 막히고, 이후 이 템플릿이
      // 만드는 모든 모듈이 파일마다 disable 주석을 달아야 한다.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettierConfig,
);
```

- [ ] **Step 3: `.prettierrc.json`과 `.prettierignore` 작성**

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true
}
```

`.prettierignore`:

`docs/`를 제외하는 이유는 설계 스펙과 구현 계획이 손으로 쓴 기록물이기 때문이다. Prettier가 표와 목록을 다시 흘리면 이 태스크의 커밋에 무관한 문서 변경이 섞인다. 참조 템플릿의 포매터(`ruff format`)도 Markdown을 건드리지 않았다.

```gitignore
dist
coverage
node_modules
pnpm-lock.yaml
docs/
.superpowers/
```

- [ ] **Step 4: `package.json`에 script 추가**

`scripts`에 아래 세 줄을 더한다.

```json
"lint": "eslint .",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 5: 포맷 적용 후 린트 통과 확인**

Run: `pnpm format && pnpm lint && pnpm format:check`
Expected: `format`이 파일을 정리하고, `lint`와 `format:check`가 출력 없이 종료 코드 0

- [ ] **Step 6: 커밋**

```bash
git add package.json pnpm-lock.yaml eslint.config.js .prettierrc.json .prettierignore
git add -u
git commit -m "chore: ESLint flat config와 Prettier 구성

타입 인식 규칙(strictTypeChecked)을 켜서 비동기 누수와 any 확산을
tsc 밖에서도 잡는다. 설정용 .js 파일은 tsconfig include 밖이므로
disableTypeChecked로 분리한다."
```

---

### Task 4: 환경 변수 설정 로더

**Files:**
- Create: `src/config/settings.ts`
- Test: `test/config/settings.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `class SettingsError extends Error`
  - `requireEnv(name: string, env?: NodeJS.ProcessEnv): string`
  - `optionalInteger(name: string, fallback: number, env?: NodeJS.ProcessEnv): number`
  - `optionalNonNegativeInteger(name: string, fallback: number, env?: NodeJS.ProcessEnv): number`
  - `interface ServerSettings { readonly port: number }`
  - `loadServerSettings(env?: NodeJS.ProcessEnv): ServerSettings`

  Phase 2는 여기에 `loadDatabaseSettings`를, Phase 6은 `loadAuthSettings`를, Phase 7은 `loadBrokerSettings`를 같은 프리미티브 위에 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/config/settings.spec.ts`:

```ts
import {
  SettingsError,
  loadServerSettings,
  optionalInteger,
  optionalNonNegativeInteger,
  requireEnv,
} from '../../src/config/settings.js';

describe('requireEnv', () => {
  it('값이 있으면 그대로 돌려준다', () => {
    expect(requireEnv('DATABASE_URL', { DATABASE_URL: 'postgres://x' })).toBe('postgres://x');
  });

  it('없으면 변수 이름이 담긴 오류를 던진다', () => {
    expect(() => requireEnv('DATABASE_URL', {})).toThrow(SettingsError);
    expect(() => requireEnv('DATABASE_URL', {})).toThrow('DATABASE_URL is required');
  });

  it('공백만 있는 값은 없는 것으로 취급한다', () => {
    expect(() => requireEnv('DATABASE_URL', { DATABASE_URL: '   ' })).toThrow(
      'DATABASE_URL is required',
    );
  });
});

describe('optionalInteger', () => {
  it('값이 없으면 기본값을 쓴다', () => {
    expect(optionalInteger('DB_POOL_MAX', 10, {})).toBe(10);
  });

  it('정수 문자열을 파싱한다', () => {
    expect(optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: '25' })).toBe(25);
  });

  it('앞뒤 공백을 허용한다', () => {
    expect(optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: ' 25 ' })).toBe(25);
  });

  it('정수가 아니면 변수 이름이 담긴 오류를 던진다', () => {
    expect(() => optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: '2.5' })).toThrow(
      'DB_POOL_MAX must be an integer',
    );
    expect(() => optionalInteger('DB_POOL_MAX', 10, { DB_POOL_MAX: 'abc' })).toThrow(
      'DB_POOL_MAX must be an integer',
    );
  });

  it('음수도 정수로 받는다', () => {
    expect(optionalInteger('JWT_LEEWAY_SECONDS', 0, { JWT_LEEWAY_SECONDS: '-5' })).toBe(-5);
  });
});

describe('optionalNonNegativeInteger', () => {
  it('음수를 거부한다', () => {
    expect(() =>
      optionalNonNegativeInteger('REFRESH_SESSION_RETENTION_SECONDS', 604800, {
        REFRESH_SESSION_RETENTION_SECONDS: '-1',
      }),
    ).toThrow('REFRESH_SESSION_RETENTION_SECONDS must be non-negative');
  });

  it('0을 허용한다', () => {
    expect(optionalNonNegativeInteger('JWT_LEEWAY_SECONDS', 5, { JWT_LEEWAY_SECONDS: '0' })).toBe(0);
  });
});

describe('loadServerSettings', () => {
  it('PORT 기본값은 4000이다', () => {
    expect(loadServerSettings({})).toEqual({ port: 4000 });
  });

  it('PORT를 환경에서 읽는다', () => {
    expect(loadServerSettings({ PORT: '8080' })).toEqual({ port: 8080 });
  });

  it('PORT가 정수가 아니면 거부한다', () => {
    expect(() => loadServerSettings({ PORT: 'http' })).toThrow('PORT must be an integer');
  });
});

describe('env 인자를 생략했을 때의 기본값', () => {
  const PROBE = 'SETTINGS_DEFAULT_ENV_PROBE';
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) {
        Reflect.deleteProperty(process.env, key);
      }
    }
    Object.assign(process.env, snapshot);
  });

  it('requireEnv는 process.env를 읽는다', () => {
    process.env[PROBE] = 'from-process-env';

    expect(requireEnv(PROBE)).toBe('from-process-env');
  });

  it('optionalInteger는 process.env를 읽는다', () => {
    process.env[PROBE] = '42';

    expect(optionalInteger(PROBE, 10)).toBe(42);
  });

  it('optionalNonNegativeInteger는 process.env를 읽는다', () => {
    process.env[PROBE] = '7';

    expect(optionalNonNegativeInteger(PROBE, 10)).toBe(7);
  });

  it('loadServerSettings는 process.env를 읽는다', () => {
    process.env.PORT = '9090';

    expect(loadServerSettings()).toEqual({ port: 9090 });
  });
});
```

마지막 describe 블록이 없으면 **분기 커버리지가 80% 게이트를 통과하지 못한다.** 네 함수의 `env: NodeJS.ProcessEnv = process.env` 기본 파라미터는 명시적 `env`를 넘기는 테스트만으로는 실행되지 않는다.

`beforeEach`/`afterEach`가 **환경 전체를 스냅샷하고 복원하는** 이유는 두 가지다. 첫째, 테스트가 넣은 값이 다른 테스트로 새지 않아야 한다. 둘째, 그리고 이쪽이 놓치기 쉬운데, **테스트가 지운 값이 원래 있었다면 되돌아와야 한다.** `PORT`는 실행 환경(Heroku·Railway·Render, 여러 로컬 셋업)에 이미 설정돼 있는 경우가 흔하다. `delete process.env.PORT`로 끝내면 그 값이 Jest 워커 프로세스 전체에서 영구히 사라진다.

변수 이름을 나열해 하나씩 정리하지 않는 이유는 그 목록이 변수를 추가할 때마다 낡기 때문이다. 전체 스냅샷은 한 번 쓰면 계속 옳다. 동적 키 삭제에 `Reflect.deleteProperty`를 쓰는 것은 `@typescript-eslint/no-dynamic-delete` 때문이다.

**이 패턴은 이후 Phase에서 반복된다.** Phase 2의 `loadDatabaseSettings`, Phase 6의 `loadAuthSettings`, Phase 7의 `loadBrokerSettings`도 같은 `env` 기본 파라미터를 가지므로, 각각 인자를 생략하는 테스트와 위 스냅샷/복원 블록을 함께 둔다. 그 로더들이 다루는 `DATABASE_URL`·`REDIS_URL`·`JWT_SECRET_KEY`는 `PORT`보다 더 실제로 설정돼 있을 값들이다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:quick test/config/settings.spec.ts`
Expected: FAIL — `Cannot find module '../../src/config/settings.js'`

- [ ] **Step 3: 최소 구현 작성**

`src/config/settings.ts`:

```ts
/**
 * 환경 변수 파싱 프리미티브.
 *
 * 애플리케이션 코드에 암묵적 기본값을 두지 않는다. 필수 값이 없으면 변수 이름이 담긴
 * 오류로 프로세스가 시작되지 않는다. 각 Phase는 자기 설정 로더를 이 프리미티브 위에 얹는다.
 */

const INTEGER_PATTERN = /^-?\d+$/;

/** 설정 해석 실패. 프로세스 시작을 막는 것이 목적이다. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

/** 필수 환경 변수를 읽는다. 없거나 공백뿐이면 실패한다. */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new SettingsError(`${name} is required`);
  }
  return raw;
}

/** 선택 정수 환경 변수를 읽는다. 값이 없으면 `fallback`, 정수가 아니면 실패한다. */
export function optionalInteger(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new SettingsError(`${name} must be an integer`);
  }
  return Number.parseInt(trimmed, 10);
}

/** 음수를 허용하지 않는 선택 정수 환경 변수를 읽는다. */
export function optionalNonNegativeInteger(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = optionalInteger(name, fallback, env);
  if (value < 0) {
    throw new SettingsError(`${name} must be non-negative`);
  }
  return value;
}

/** HTTP 서버 설정. */
export interface ServerSettings {
  readonly port: number;
}

/** HTTP 서버 설정을 환경에서 읽는다. */
export function loadServerSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  return { port: optionalNonNegativeInteger('PORT', 4000, env) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test:quick test/config/settings.spec.ts`
Expected: PASS — 17개 테스트 통과

- [ ] **Step 5: 린트와 타입 검사**

Run: `pnpm lint && pnpm typecheck`
Expected: 출력 없이 종료 코드 0

- [ ] **Step 6: 커밋**

```bash
git add src/config/settings.ts test/config/settings.spec.ts
git commit -m "feat: 환경 변수 파싱 프리미티브 추가

암묵적 기본값 없이 변수 이름이 담긴 오류로 실패시킨다. 이후 Phase의
데이터베이스·인증·broker 설정 로더가 이 프리미티브 위에 얹힌다."
```

---

### Task 5: health 컨트롤러와 애플리케이션 조립점

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/app/controllers/health.controller.ts`
- Create: `src/config/routes.module.ts`
- Create: `src/config/app.module.ts`
- Create: `src/config/main.ts`
- Create: `test/app-factory.ts`
- Test: `test/health.controller.spec.ts`
- Test: `test/config/routes.module.spec.ts`

**Interfaces:**
- Consumes: `loadServerSettings`, `ServerSettings` (Task 4)
- Produces:
  - `class HealthController` — `live(): HealthStatus`, `ready(): HealthStatus`
  - `interface HealthStatus { readonly status: string }`
  - `class RoutesModule` — 공개 라우트의 유일한 등록 지점
  - `class AppModule` — 루트 모듈
  - `createTestApp(): Promise<INestApplication>` (`test/app-factory.ts`) — 모든 애플리케이션 테스트의 유일한 조립 지점
  - `registeredRoutes(app: INestApplication): string[]` (`test/app-factory.ts`)

- [ ] **Step 1: NestJS 의존성 설치**

Run:

```bash
pnpm add @nestjs/common@12.0.1 @nestjs/core@12.0.1 @nestjs/platform-express@12.0.1 rxjs@7.8.1
pnpm add -D @nestjs/testing@12.0.1 supertest@7.2.2 @types/supertest@7.2.1
```

Expected: 설치 성공

- [ ] **Step 2: 실패하는 테스트 작성**

`test/health.controller.spec.ts`:

```ts
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app-factory.js';

// supertest는 `response.body`를 `any`로 노출한다. `strictTypeChecked`의
// `no-unsafe-argument`에 걸리므로 단언 전에 명시적으로 좁힌다.
//
// `INestApplication`의 `TServer` 제네릭 기본값도 `any`라 `getHttpServer()`가
// `any`를 흘린다. `INestApplication<Server>`로 좁혀 같은 규칙을 통과시킨다.
interface HealthBody {
  readonly status: string;
}

describe('HealthController', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<Server>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live 는 200과 ok 를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body as HealthBody).toEqual({ status: 'ok' });
  });

  it('GET /health/ready 는 200과 ok 를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body as HealthBody).toEqual({ status: 'ok' });
  });

  it('JSON:API vendor 타입이 아니라 평문 JSON으로 응답한다', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.headers['content-type']).toMatch(/^application\/json/);
  });

  it('없는 health 경로는 404다', async () => {
    const response = await request(app.getHttpServer()).get('/health/unknown');

    expect(response.status).toBe(404);
  });
});
```

`test/config/routes.module.spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { createTestApp, registeredRoutes } from '../app-factory.js';

describe('명시적 라우트 조립', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<Server>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('RoutesModule에 등록한 라우트만 노출한다', () => {
    expect(registeredRoutes(app)).toEqual(['GET /health/live', 'GET /health/ready']);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm test:quick test/health.controller.spec.ts test/config/routes.module.spec.ts`
Expected: FAIL — `Cannot find module './app-factory.js'`

- [ ] **Step 4: 컨트롤러와 모듈 구현**

`src/app/controllers/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

/** 상태 확인 응답. */
export interface HealthStatus {
  readonly status: string;
}

/**
 * 상태 확인 컨트롤러.
 *
 * JSON:API 협상 대상이 아니다. vendor 미디어 타입 없이 평문 JSON을 반환한다.
 * liveness는 어떤 외부 자원도 해석하지 않는다.
 * readiness의 데이터베이스 확인은 Phase 2에서 추가한다.
 */
@Controller('health')
export class HealthController {
  @Get('live')
  live(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): HealthStatus {
    return { status: 'ok' };
  }
}
```

`src/config/routes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from '../app/controllers/health.controller.js';

/**
 * 공개 라우트의 유일한 등록 지점.
 *
 * 컨트롤러 자동 탐색을 추가하지 않는다. 아래 배열에 없는 컨트롤러는 존재하지 않는 것과 같다.
 */
@Module({
  controllers: [HealthController],
})
export class RoutesModule {}
```

`src/config/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RoutesModule } from './routes.module.js';

/** 애플리케이션 루트 모듈. 전역 미들웨어와 필터는 여기에서 등록 순서까지 검토한다. */
@Module({
  imports: [RoutesModule],
})
export class AppModule {}
```

- [ ] **Step 5: 테스트 조립점 작성**

`test/app-factory.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/config/app.module.js';

/**
 * 애플리케이션 테스트의 유일한 조립 지점.
 *
 * 테스트가 `Test.createTestingModule`을 직접 호출하지 않는다. 조립 방식이 갈라지면
 * 프로덕션 팩토리와 테스트 팩토리가 서로 다른 앱을 검증하게 된다.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

interface ExpressRoute {
  readonly path: string;
  readonly methods: Record<string, boolean>;
}

interface ExpressLayer {
  readonly route?: ExpressRoute;
}

interface ExpressRouter {
  readonly stack: readonly ExpressLayer[];
}

interface ExpressInstance {
  readonly router?: ExpressRouter;
  readonly _router?: ExpressRouter;
}

/**
 * OpenAPI 문서화가 등록하는 경로들. 애플리케이션 라우트가 아니라 문서 UI의 정적 자산이다.
 *
 * `SwaggerModule.setup`은 라우터 스택에 8개 레이어를 남긴다(`/api-docs`, `/api-docs-yaml`,
 * `/api-docs/LICENSE`, `/api-docs/swagger-ui-init.js` 등). 이 목록을 라우트 계약에 넣으면
 * `@nestjs/swagger`의 내부 자산 배치가 바뀔 때마다 테스트가 깨진다. `/api/schema`의 실제
 * 노출은 `test/config/openapi.spec.ts`가 HTTP 요청으로 따로 확인한다.
 */
function isDocumentationPath(path: string): boolean {
  return path === '/api/schema' || path === '/api-docs-yaml' || path.startsWith('/api-docs');
}

/**
 * 애플리케이션이 실제로 노출하는 라우트 집합을 `"METHOD /path"` 문자열로 돌려준다.
 *
 * 라우트가 조용히 늘거나 사라지는 것을 잡기 위한 것이므로 정렬된 배열로 고정 비교한다.
 * OpenAPI 문서 경로는 제외한다. 이 템플릿은 모든 애플리케이션 라우트를 `/api/v1`과
 * `/health` 아래에만 두므로 이 제외가 실제 라우트를 가리지 않는다.
 */
export function registeredRoutes(app: INestApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as ExpressInstance;
  const router = instance.router ?? instance._router;
  const routes: string[] = [];

  for (const layer of router?.stack ?? []) {
    if (layer.route === undefined || isDocumentationPath(layer.route.path)) {
      continue;
    }
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled) {
        routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
  }

  return routes.sort();
}
```

- [ ] **Step 6: 프로세스 진입점 작성**

`src/config/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadServerSettings } from './settings.js';

async function bootstrap(): Promise<void> {
  const settings = loadServerSettings();
  const app = await NestFactory.create(AppModule);
  await app.listen(settings.port, '0.0.0.0');
}

await bootstrap();
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm test:quick test/health.controller.spec.ts test/config/routes.module.spec.ts`
Expected: PASS — 5개 테스트 통과

- [ ] **Step 8: 실제 기동 확인**

Run: `pnpm build && node dist/config/main.js`
별도 터미널에서: `curl -s http://localhost:4000/health/live`
Expected: `{"status":"ok"}`. 확인 후 프로세스를 종료한다

- [ ] **Step 9: 전체 검사**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 모두 통과, 커버리지 게이트 80% 충족

- [ ] **Step 10: 커밋**

```bash
git add package.json pnpm-lock.yaml src/app/controllers/health.controller.ts src/config/routes.module.ts src/config/app.module.ts src/config/main.ts test/app-factory.ts test/health.controller.spec.ts test/config/routes.module.spec.ts
git commit -m "feat: health 컨트롤러와 명시적 라우트 조립점 추가

RoutesModule의 controllers 배열이 공개 라우트의 유일한 등록 지점이다.
라우트 집합을 통째로 고정하는 테스트를 함께 두어 자동 탐색이나 우발적
노출을 막는다."
```

---

### Task 6: OpenAPI 문서

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/config/openapi.ts`
- Modify: `src/config/main.ts`
- Modify: `test/app-factory.ts`
- Test: `test/config/openapi.spec.ts`

**Interfaces:**
- Consumes: `AppModule` (Task 5), `createTestApp` (Task 5)
- Produces: `setupOpenApi(app: INestApplication): void` — `/api-docs`(UI)와 `/api/schema`(JSON)를 등록한다

`@nestjs/swagger`의 CLI 플러그인은 webpack 빌드를 전제하므로 쓰지 않는다. 스키마는 `@ApiProperty` 등 명시 데코레이터로만 표현한다. 이 태스크가 그 방식으로 문서가 생성되는지 확인한다.

- [ ] **Step 1: 의존성 설치**

Run: `pnpm add @nestjs/swagger@12.0.0`
Expected: 설치 성공

- [ ] **Step 2: 실패하는 테스트 작성**

`test/config/openapi.spec.ts`:

```ts
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';

interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, unknown>;
}

describe('OpenAPI 문서', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = (await createTestApp()) as INestApplication<Server>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/schema 가 OpenAPI 문서를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/api/schema');

    expect(response.status).toBe(200);

    const document = response.body as OpenApiDocument;
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.version).toBe('0.1.0');
  });

  it('명시적으로 조립한 라우트만 문서에 나온다', async () => {
    const response = await request(app.getHttpServer()).get('/api/schema');
    const document = response.body as OpenApiDocument;

    expect(Object.keys(document.paths).sort()).toEqual(['/health/live', '/health/ready']);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm test:quick test/config/openapi.spec.ts`
Expected: FAIL — `GET /api/schema`가 404를 반환한다

- [ ] **Step 4: OpenAPI 설정 구현**

`src/config/openapi.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI 문서를 등록한다.
 *
 * `@nestjs/swagger`의 CLI 플러그인은 webpack 빌드를 전제하므로 쓰지 않는다.
 * 스키마는 `@ApiProperty` 등 명시 데코레이터로만 표현한다.
 * `app.init()` 전에 호출해야 한다.
 *
 * `addBearerAuth()`를 넣지 않는다. Phase 0에는 인증된 라우트가 없어서, 지금 넣으면
 * 발행되는 문서가 어떤 operation에도 걸리지 않는 인증 메커니즘을 광고하게 되고
 * 이 스키마로 클라이언트를 생성하는 쪽을 오도한다. Phase 6에서 첫 `@ApiBearerAuth()`
 * 라우트를 만들 때 그 변경과 함께 추가한다.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('NestJS Template')
    .setDescription('NestJS JSON:API 1.1 템플릿')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document, {
    jsonDocumentUrl: 'api/schema',
  });
}
```

- [ ] **Step 5: 테스트 조립점에 연결**

`test/app-factory.ts`의 `createTestApp`을 아래로 바꾼다. `setupOpenApi` import를 파일 상단에 추가한다.

```ts
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupOpenApi(app);
  await app.init();
  return app;
}
```

추가할 import:

```ts
import { setupOpenApi } from '../src/config/openapi.js';
```

- [ ] **Step 6: 프로세스 진입점에 연결**

`src/config/main.ts`의 `bootstrap`을 아래로 바꾸고 `setupOpenApi` import를 추가한다.

```ts
async function bootstrap(): Promise<void> {
  const settings = loadServerSettings();
  const app = await NestFactory.create(AppModule);
  setupOpenApi(app);
  await app.listen(settings.port, '0.0.0.0');
}
```

추가할 import:

```ts
import { setupOpenApi } from './openapi.js';
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm test:quick`
Expected: PASS — 기존 테스트를 포함해 전부 통과

특히 `test/config/routes.module.spec.ts`가 계속 통과해야 한다. `SwaggerModule.setup`은 라우터 스택에 문서 UI 자산 라우트 8개를 추가하지만, Task 5의 `isDocumentationPath` 제외 규칙이 이를 걸러낸다. 이 테스트가 깨진다면 제외 규칙이 실제 등록 경로와 어긋난 것이므로, 기대값을 늘리지 말고 제외 규칙을 고친다.

- [ ] **Step 8: 커밋**

```bash
git add package.json pnpm-lock.yaml src/config/openapi.ts src/config/main.ts test/app-factory.ts test/config/openapi.spec.ts
git commit -m "feat: OpenAPI 문서 노출

CLI 플러그인은 webpack 빌드를 전제하므로 쓰지 않고 명시 데코레이터만
사용한다. 문서에 나오는 경로 집합을 고정해 조립되지 않은 라우트가
문서에만 나타나는 상황을 막는다."
```

---

### Task 7: secretlint와 커밋 훅

**Files:**
- Modify: `package.json` (devDependencies, script, `lint-staged`)
- Create: `.secretlintrc.json`
- Create: `.husky/pre-commit`

**Interfaces:**
- Consumes: npm script `lint`, `format`, `typecheck` (Task 3, Task 1)
- Produces: npm script `secretlint`. 커밋 시 `lint-staged`와 `typecheck`가 자동 실행된다

- [ ] **Step 1: 의존성 설치**

Run:

```bash
pnpm add -D secretlint@13.0.5 @secretlint/secretlint-rule-preset-recommend@13.0.5 husky@9.1.7 lint-staged@17.4.1
```

Expected: 설치 성공

- [ ] **Step 2: `.secretlintrc.json` 작성**

```json
{
  "rules": [
    {
      "id": "@secretlint/secretlint-rule-preset-recommend"
    }
  ]
}
```

- [ ] **Step 3: `package.json`에 script와 lint-staged 설정 추가**

`scripts`에 추가:

```json
"secretlint": "secretlint --secretlintignore .gitignore \"**/*\"",
"prepare": "husky"
```

최상위에 추가:

```json
"lint-staged": {
  "*.ts": ["eslint --fix", "prettier --write"],
  "*.{js,json,md,yml,yaml}": ["prettier --write"]
}
```

- [ ] **Step 4: secretlint가 통과하는지 확인**

Run: `pnpm secretlint`
Expected: 종료 코드 0. 비밀 정보가 검출되지 않는다

- [ ] **Step 5: secretlint가 실제로 잡는지 1회 확인**

저장소 루트에 임시 파일을 만든다. 값은 **이 문서에 적지 않고 실행 시점에 생성한다.**

```bash
printf 'GITHUB_TOKEN=ghp_%s\n' \
  "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 36)" > secret-probe.txt
```

탐지되는 형태의 토큰을 이 계획 문서에 리터럴로 적으면 **문서 자체가 secretlint에 걸려 게이트가 막힌다.** 실제로 그렇게 적었다가 `docs/superpowers/plans/...`가 `found GitHub Token`으로 잡혀 `pnpm secretlint`가 exit 1이 되는 일이 있었다. 검증용 비밀은 저장소에 남기지 않고 그때그때 만든다.

**AWS 예시 키(`AKIAIOSFODNN7EXAMPLE`)를 쓰지 않는다.** 그 값은 AWS 공식 문서의 플레이스홀더라 secretlint를 포함한 대부분의 스캐너가 의도적으로 화이트리스트에 넣는다. 같은 이유로 `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`도 검출되지 않는다. 그런 값으로 시험하면 **탐지가 되는데도 안 되는 것처럼 보이거나, 반대로 게이트가 동작한다고 잘못 믿게 된다.**

Run: `pnpm secretlint`
Expected: FAIL — 종료 코드가 0이 아니고 아래와 같은 출력이 나온다

```text
  1:14  error  [GITHUB_TOKEN] found GitHub Token(...)  @secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-github
✖ 1 problem (1 error, 0 warnings, 0 infos)
```

**AWS Access Key ID는 기본 설정에서 검사되지 않는다.** `@secretlint/secretlint-rule-aws`의 `enableIDScanRule` 옵션이 기본값 `false`이기 때문이다. 이 기본값을 바꾸지 않는다 — Access Key ID는 자격 증명이 아니라 식별자(사용자명에 해당)이고, 실제 비밀인 Secret Access Key는 기본 설정에서 정상 탐지된다. 템플릿이 오탐이 잦은 정책을 복제하는 모든 사람에게 강제할 이유가 없다. 대신 이 경계가 의도된 것임을 여기 남긴다.

종료 코드를 확인할 때 파이프를 쓰지 않는다. `pnpm secretlint | tail`의 `$?`는 secretlint가 아니라 `tail`의 종료 코드다.

확인 후 파일을 지운다. 이 파일은 절대 커밋하지 않는다.

Run: `rm secret-probe.txt && pnpm secretlint`
Expected: PASS (종료 코드 0)

설정이 실제로 로드되는지도 한 번 확인한다. `.secretlintrc.json`의 rule id를 존재하지 않는 값으로 잠시 바꾸고 실행하면 `exit 2`와 함께 `Failed to load rule module`이 나와야 한다. 아무 규칙도 로드되지 않은 채 조용히 통과하는 상태와, 규칙이 로드됐지만 걸릴 게 없어 통과하는 상태는 종료 코드가 똑같이 0이라 겉으로 구분되지 않는다. 확인 후 원래 값으로 되돌린다.

- [ ] **Step 6: husky 훅 설치**

Run: `pnpm exec husky init`
Expected: `.husky/` 디렉터리와 `pre-commit` 파일 생성

`.husky/pre-commit` 내용을 아래로 바꾼다.

```bash
pnpm exec lint-staged
pnpm run typecheck
```

- [ ] **Step 7: 훅이 동작하는지 확인**

Run: `pnpm secretlint && pnpm lint && pnpm typecheck`
Expected: 모두 통과

- [ ] **Step 8: 커밋**

```bash
git add package.json pnpm-lock.yaml .secretlintrc.json .husky/pre-commit
git commit -m "chore: secretlint와 커밋 훅 구성

참조 템플릿의 pre-commit + detect-secrets 조합을 npm 네이티브
도구로 대체한다. TS 저장소가 Python 런타임을 요구하지 않게 한다."
```

---

### Task 8: Docker 이미지와 Compose 스택

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `docker-compose.test.yml`
- Create: `.env.example`

**Interfaces:**
- Consumes: npm script `build`, `start` (Task 1), `/health/ready` (Task 5)
- Produces: `runtime` 빌드 타깃. Compose 서비스 `db`, `redis`, `api`. 테스트 전용 Compose 파일이 `TEST_DB_PORT` 환경 변수로 포트를 받는다

`db`와 `redis`는 Phase 0에서 아직 쓰이지 않지만 지금 정의한다. Phase 2와 Phase 7이 환경 변수 연결만 추가하면 되고, `docker compose up --wait`가 모든 Phase에서 같은 형태로 동작한다.

- [ ] **Step 1: `.dockerignore` 작성**

```gitignore
node_modules
dist
coverage
.git
.github
.husky
docs
test
scripts
*.md
.env
```

- [ ] **Step 2: `Dockerfile` 작성**

```dockerfile
FROM node:24-slim AS builder

WORKDIR /app
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod --ignore-scripts

FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN useradd --system --create-home --shell /bin/bash app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/config/main.js"]
```

- [ ] **Step 3: `.env.example` 작성**

```dotenv
# API 서버 포트입니다.
PORT=4000

# PostgreSQL Compose 자격 증명입니다. 개발 전용 값입니다.
POSTGRES_DB=nestjs_template
POSTGRES_USER=nestjs
POSTGRES_PASSWORD=nestjs
```

- [ ] **Step 4: `docker-compose.yml` 작성**

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-nestjs_template}
      POSTGRES_USER: ${POSTGRES_USER:-nestjs}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-nestjs}
    ports:
      - '127.0.0.1:5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-nestjs} -d ${POSTGRES_DB:-nestjs_template}']
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 5s

  redis:
    image: redis:8-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 5s

  api:
    build: .
    environment:
      PORT: ${PORT:-4000}
    ports:
      - '4000:4000'

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 5: `docker-compose.test.yml` 작성**

`published`를 `${TEST_DB_PORT:-55432}`로 두는 이유는 `scripts/check.sh`가 `TEST_DB_PORT=0`으로 임의 포트를 받아 병렬 실행 충돌을 피하기 때문이다.

```yaml
name: template-typescript-nestjs-test

services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: nestjs_template_test
      POSTGRES_USER: nestjs
      POSTGRES_PASSWORD: nestjs
    ports:
      - target: 5432
        published: '${TEST_DB_PORT:-55432}'
        host_ip: 127.0.0.1
        protocol: tcp
    volumes:
      - test_postgres_data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U nestjs -d nestjs_template_test']
      interval: 2s
      timeout: 5s
      retries: 15
      start_period: 5s

volumes:
  test_postgres_data:
```

- [ ] **Step 6: Compose 설정 검증**

Run: `docker compose config --quiet && docker compose -f docker-compose.test.yml config --quiet`
Expected: 두 명령 모두 출력 없이 종료 코드 0

- [ ] **Step 7: runtime 이미지 빌드**

Run: `docker build --target runtime --tag template-typescript-nestjs:verify .`
Expected: 빌드 성공

builder 단계의 두 줄에는 각각 이유가 있다. 둘 다 이 계획을 처음 쓴 뒤에 내린 룰링의 결과라, 그 룰링을 모르면 원인을 찾기 어렵다.

- `COPY`에 **`pnpm-workspace.yaml`이 포함되어야 한다.** Task 2에서 `overrides`를 `package.json`의 `pnpm` 필드에서 이 파일로 옮겼고(pnpm 11이 전자를 무시한다), 그 순간부터 `pnpm-lock.yaml`이 이 파일의 내용에 의존하게 됐다. 없이 `pnpm install --frozen-lockfile`을 돌리면 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`로 실패한다.
- `prune`에 **`--ignore-scripts`가 필요하다.** Task 7이 `"prepare": "husky"`를 추가했기 때문에, `pnpm prune --prod`가 devDependencies에서 husky를 제거한 **직후** `prepare`를 재실행하다 `sh: 1: husky: not found`로 exit 1이 된다. `HUSKY=0`은 소용없다 — 셸이 바이너리를 찾지 못해 husky가 그 환경변수를 읽기 전에 죽는다. `prepare` 쪽을 `husky || true`로 무력화하지 않는 이유는, 로컬에서 훅 설치가 진짜로 실패할 때는 시끄럽게 실패해야 하기 때문이다. prod 의존성을 쳐내는 명령이 lifecycle 스크립트를 돌릴 이유도 없다.

pnpm은 `node_modules`를 심볼릭 링크 구조로 만든다. 두 단계 모두 `WORKDIR`이 `/app`이라 상대 링크가 그대로 유효하다(실측으로 확인했고 폴백은 필요하지 않았다). 만약 runtime 이미지가 `ERR_MODULE_NOT_FOUND`로 실패하면 저장소 루트에 `.npmrc`를 만들어 링크 대신 평면 구조를 쓰게 한다.

```ini
node-linker=hoisted
```

이 경우 `.npmrc`를 커밋하고 `pnpm install`을 다시 실행한 뒤 이미지를 재빌드한다.

- [ ] **Step 8: 전체 스택 기동 확인**

Run: `docker compose up -d --build --wait`
Expected: `db`, `redis`, `api` 모두 healthy

Run: `curl -s http://localhost:4000/health/ready`
Expected: `{"status":"ok"}`

Run: `docker compose down -v`
Expected: 정리 완료

- [ ] **Step 9: 커밋**

```bash
git add Dockerfile .dockerignore docker-compose.yml docker-compose.test.yml .env.example
git commit -m "chore: Docker runtime 이미지와 Compose 스택 추가

runtime 단계는 비특권 사용자로 실행하고 prod 의존성만 담는다.
db와 redis는 지금 쓰이지 않지만 미리 정의해 이후 Phase가 환경 변수
연결만 추가하도록 한다."
```

---

### Task 9: 단일 검증 게이트

**Files:**
- Create: `scripts/check.sh`
- Modify: `package.json` (script)
- Test: `test/scripts/check-script.spec.ts`

**Interfaces:**
- Consumes: `docker-compose.test.yml` (Task 8), npm script `lint`/`format:check`/`typecheck`/`test`/`secretlint` (Task 1, 3, 7)
- Produces: `scripts/check.sh` — CI와 로컬이 공유하는 유일한 전체 게이트. npm script `check`

- [ ] **Step 1: 실패하는 테스트 작성**

`check.sh`는 Docker를 띄우므로 단위 테스트에서 실행하지 않는다. 대신 스크립트가 지켜야 할 계약을 텍스트로 고정한다.

`test/scripts/check-script.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../../scripts/check.sh', import.meta.url));
const script = readFileSync(scriptPath, 'utf8');

describe('scripts/check.sh', () => {
  it('오류와 미정의 변수에서 즉시 중단한다', () => {
    expect(script).toContain('set -euo pipefail');
  });

  it('종료 시 임시 데이터베이스를 정리한다', () => {
    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain('down -v');
  });

  it('이미 주어진 TEST_DATABASE_URL을 존중한다', () => {
    expect(script).toContain('if [[ -z "${TEST_DATABASE_URL:-}" ]]; then');
  });

  it('임의 포트로 임시 데이터베이스를 띄운다', () => {
    expect(script).toContain('TEST_DB_PORT=0');
  });

  it('다섯 가지 검사를 순서대로 실행한다', () => {
    const checks = [
      'pnpm exec eslint .',
      'pnpm exec prettier --check .',
      'pnpm exec tsc --noEmit -p tsconfig.json',
      'pnpm run test',
      'pnpm exec secretlint',
    ];
    const positions = checks.map((check) => script.indexOf(check));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:quick test/scripts/check-script.spec.ts`
Expected: FAIL — `ENOENT: no such file or directory ... scripts/check.sh`

- [ ] **Step 3: `scripts/check.sh` 작성**

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_root="$(cd "$script_dir/.." && pwd)"
compose_file="$api_root/docker-compose.test.yml"
test_project_name="template-typescript-nestjs-test-$$-$RANDOM"
compose_args=(-f "$compose_file" -p "$test_project_name")
started_test_database=false

cleanup() {
  if [[ "$started_test_database" == true ]]; then
    docker compose "${compose_args[@]}" down -v
  fi
}

trap cleanup EXIT
cd "$api_root"

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  started_test_database=true
  TEST_DB_PORT=0 docker compose "${compose_args[@]}" up -d --wait db
  test_database_endpoint="$(docker compose "${compose_args[@]}" port db 5432)"
  test_database_port="${test_database_endpoint##*:}"
  export TEST_DATABASE_URL="postgres://nestjs:nestjs@127.0.0.1:${test_database_port}/nestjs_template_test"
fi

pnpm exec eslint .
pnpm exec prettier --check .
pnpm exec tsc --noEmit -p tsconfig.json
pnpm run test
pnpm exec secretlint --secretlintignore .gitignore "**/*"
```

- [ ] **Step 4: 실행 권한 부여**

Run: `chmod +x scripts/check.sh && git update-index --chmod=+x scripts/check.sh`
Expected: 오류 없음

- [ ] **Step 5: `package.json`에 script 추가**

`scripts`에 추가:

```json
"check": "./scripts/check.sh"
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm test:quick test/scripts/check-script.spec.ts`
Expected: PASS — 5개 테스트 통과

- [ ] **Step 7: 전체 게이트 실행**

Run: `./scripts/check.sh`
Expected: 임시 PostgreSQL이 뜨고, eslint → prettier → tsc → jest → secretlint가 순서대로 통과한 뒤 임시 DB가 정리된다

- [ ] **Step 8: 커밋**

```bash
git add scripts/check.sh package.json test/scripts/check-script.spec.ts
git commit -m "chore: 단일 검증 게이트 scripts/check.sh 추가

임시 Docker PostgreSQL을 임의 포트에 띄우고 종료 시 정리한다.
CI도 같은 스크립트를 호출해 로컬과 갈라지지 않게 한다."
```

---

### Task 10: CI와 README

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Test: `test/docs/readme.spec.ts`

**Interfaces:**
- Consumes: `scripts/check.sh` (Task 9), `Dockerfile` (Task 8)
- Produces: CI 워크플로. `README.md`의 `## 검증` 절이 전체 검증 명령의 기준 문자열이 된다. Phase 8이 `AGENTS.md`를 추가할 때 이 테스트를 확장한다

- [ ] **Step 1: 실패하는 테스트 작성**

`test/docs/readme.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url));
const readme = readFileSync(readmePath, 'utf8');

/**
 * 스펙이 정한 전체 검증 명령. README와 문자열 단위로 같아야 한다.
 * Phase 8에서 AGENTS.md가 추가되면 그 문서까지 같은 목록을 공유하는지 확인한다.
 */
const VERIFICATION_COMMANDS = [
  'pnpm install --frozen-lockfile',
  './scripts/check.sh',
  'docker compose config --quiet',
  'docker build --target runtime --tag template-typescript-nestjs:verify .',
  'docker compose up -d --build --wait',
  'docker compose down -v',
];

describe('README', () => {
  it('검증 절을 가진다', () => {
    expect(readme).toContain('## 검증');
  });

  it('전체 검증 명령을 문자열 그대로 담는다', () => {
    for (const command of VERIFICATION_COMMANDS) {
      expect(readme).toContain(command);
    }
  });

  it('검증 명령이 스펙과 같은 순서로 나온다', () => {
    const positions = VERIFICATION_COMMANDS.map((command) => readme.indexOf(command));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('ESM 상대 import 제약을 명시한다', () => {
    expect(readme).toContain('.js');
    expect(readme).toContain('ESM');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:quick test/docs/readme.spec.ts`
Expected: FAIL — `ENOENT: no such file or directory ... README.md`

- [ ] **Step 3: `README.md` 작성**

````markdown
# TypeScript NestJS Template

NestJS 12, TypeORM, PostgreSQL로 구성할 JSON:API 1.1 템플릿입니다. 현재 Phase 0(기반과 검증 게이트)까지 구현되어 있습니다.

## 요구 사항

- Node.js 24.11.0 이상
- pnpm 11
- Docker (검증 게이트와 Compose 스택에 필요합니다)

## 구조

```text
src/app/          # 도메인 계층 (컨트롤러, JSON:API 프로토콜, 모델)
src/config/       # 조립점 (앱 모듈, 명시 라우트, 설정)
src/db/           # 마이그레이션과 시드
test/             # 단위·PostgreSQL 통합 테스트
scripts/check.sh  # 단일 검증 게이트
```

## ESM 제약

이 템플릿은 ESM 패키지입니다(`"type": "module"`). NestJS 12가 ESM 전용이라 선택이 아니라 전제입니다.

**모든 상대 import에 `.js` 확장자를 붙여야 합니다.**

```ts
import { AppModule } from './app.module.js'; // 올바름
import { AppModule } from './app.module'; // TS2835 오류
```

`pnpm typecheck`가 이 규칙의 게이트입니다. 별도 린트 규칙은 두지 않습니다.

TypeScript는 6.0.3에 고정되어 있습니다. 7.x는 네이티브 컴파일러라 JS 컴파일러 API를 노출하지 않아 `ts-jest`와 `typescript-eslint`가 동작하지 않습니다.

## 로컬 실행

```bash
pnpm install
pnpm build
pnpm start
```

- API: `http://localhost:4000`
- OpenAPI 문서: `http://localhost:4000/api-docs`
- OpenAPI 스키마: `http://localhost:4000/api/schema`
- 상태 확인: `http://localhost:4000/health/live`, `http://localhost:4000/health/ready`

## Docker로 실행

```bash
docker compose up -d --build --wait
curl -s http://localhost:4000/health/ready
docker compose down -v
```

## 환경 변수

| 변수 | 기본값 | 비고 |
| --- | --- | --- |
| `PORT` | `4000` | 정수가 아니면 `PORT must be an integer`로 실패합니다 |
| `POSTGRES_DB` | `nestjs_template` | Compose 전용입니다 |
| `POSTGRES_USER` | `nestjs` | Compose 전용입니다 |
| `POSTGRES_PASSWORD` | `nestjs` | Compose 전용 개발 값입니다 |

애플리케이션 코드에는 암묵적 기본값이 없습니다. 값이 잘못되면 변수 이름이 담긴 오류와 함께 프로세스가 시작되지 않습니다.

## 개별 검사

```bash
pnpm lint          # eslint .
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
pnpm typecheck     # tsc --noEmit
pnpm test          # jest (커버리지 게이트 80% 포함)
pnpm test:quick    # jest (커버리지 없이 빠르게)
pnpm secretlint    # 비밀 정보 탐지
pnpm check         # ./scripts/check.sh 전체 게이트
```

`check`를 제외한 모든 태스크는 bash 없이 Windows에서 동작합니다. `check`는 bash 스크립트이므로 Git Bash 또는 WSL이 필요합니다.

## 검증

전체 검사는 격리된 실제 PostgreSQL 테스트 DB를 자동으로 실행하고 정리합니다.

```bash
pnpm install --frozen-lockfile
./scripts/check.sh
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

검사 범위는 ESLint, Prettier, strict TypeScript, Jest와 커버리지, 비밀 정보 탐지입니다. 타입 검사는 `src`뿐 아니라 `test`까지 포함합니다.
````

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test:quick test/docs/readme.spec.ts`
Expected: PASS — 4개 테스트 통과

- [ ] **Step 5: CI 워크플로 작성**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: pnpm 설정
        uses: pnpm/action-setup@v4
        with:
          version: 11.22.0

      - name: Node 설정
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: pnpm

      - name: 고정된 의존성 설치
        run: pnpm install --frozen-lockfile

      - name: 실제 PostgreSQL 기반 전체 검사
        run: ./scripts/check.sh

      - name: Compose 설정 검증
        run: docker compose config --quiet

      - name: 운영 runtime 이미지 빌드
        run: docker build --target runtime --tag template-typescript-nestjs:ci .
```

- [ ] **Step 6: 전체 게이트 최종 실행**

Run: `./scripts/check.sh`
Expected: 전부 통과

- [ ] **Step 7: 스펙의 전체 검증 명령 실행**

Run:

```bash
pnpm install --frozen-lockfile
docker compose config --quiet
docker build --target runtime --tag template-typescript-nestjs:verify .
docker compose up -d --build --wait
docker compose down -v
```

Expected: 모두 성공

- [ ] **Step 8: 커밋**

```bash
git add .github/workflows/ci.yml README.md test/docs/readme.spec.ts
git commit -m "docs: README와 CI 워크플로 추가

CI가 scripts/check.sh를 그대로 호출해 로컬 게이트와 갈라지지 않게 한다.
README의 검증 명령은 문서 테스트가 순서까지 고정한다."
```

---

## Phase 0 완료 조건

아래가 모두 참이면 Phase 0이 끝난 것이다.

- [ ] `./scripts/check.sh`가 통과한다 (ESLint, Prettier, strict tsc, Jest 80% 커버리지, secretlint)
- [ ] `docker compose up -d --build --wait` 후 `curl http://localhost:4000/health/ready`가 `{"status":"ok"}`를 반환한다
- [ ] `docker build --target runtime`이 성공한다
- [ ] `GET /api/schema`가 `/health/live`와 `/health/ready`만 담은 OpenAPI 문서를 반환한다
- [ ] 상대 import에서 `.js`를 빼면 `pnpm typecheck`가 `TS2835`로 실패한다
- [ ] 커밋 시 husky 훅이 `lint-staged`와 `typecheck`를 실행한다

## 다음 Phase로 넘길 항목

Phase 0에서 의도적으로 남긴 것들이다. 누락이 아니라 순서다.

| 항목 | 담당 Phase |
| --- | --- |
| `/health/ready`의 데이터베이스 확인 | 2 |
| `loadDatabaseSettings` (`DATABASE_URL`, 풀 설정) | 2 |
| `loadAuthSettings` (`JWT_*`) | 6 |
| `loadBrokerSettings` (`REDIS_URL`) | 7 |
| Compose `migrate` 서비스 | 2 |
| Compose `worker` 서비스 | 7 |
| `AGENTS.md` 문서군과 문서 동기화 테스트 확장 | 8 |
| JSON:API 협상·오류 필터 (`JSONAPI_MEDIA_TYPE` 소비처) | 1 |
