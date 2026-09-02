# src/config/ — 프로세스 조립

이 디렉터리는 환경 변수를 설정 객체로 바꾸고, 그 설정으로 `DataSource`·HTTP 서버·
라우트를 조립한다. 파일별로 무엇이 있는지는 디렉터리를 열어 보는 쪽이 빠르므로
나열하지 않는다 — 이 문서가 적는 것은 왜 이런 모양을 골랐는가와, 이 모양이
깨지면 무엇이 조용히 무너지는가다.

## 왜 `@nestjs/config`가 아니라 손으로 쓴 `settings.ts`인가

`@nestjs/config`는 필수 변수가 없어도 프로세스를 띄운다 — 그 값을 실제로 쓰는
첫 요청이 와서야 `undefined`가 드러난다. 이 저장소는 반대를 계약으로 삼는다.
`src/config/settings.ts`의 `requireEnv`·`requireEnvMinBytes` 같은 프리미티브는
필수 값이 없으면 변수 이름을 담은 오류로 즉시 던지고, `loadDatabaseSettings`·
`loadJwtSettings`·`loadWorkerSettings` 같은 로더는 각자의 도메인이 요구하는
하한(풀 크기 1 이상, 만료 1초 이상, 키 32바이트 이상 등)을 그 프리미티브 위에
얹는다. 그래서 설정 실수는 언제나 배포 시점의 시작 실패로 나타나고, 운영 중인
요청의 500으로 나타나지 않는다.

## 왜 조립 시점에 설정을 읽는가

`src/config/app.module.ts`는 `TypeOrmModule.forRootAsync`의 `useFactory`에서
`loadDatabaseSettings()`를, `src/config/routes.module.ts`는 `JWT_SETTINGS_TOKEN`
프로바이더의 `useFactory`에서 `loadJwtSettings()`를 부른다. 둘 다 Nest가 모듈
그래프를 조립하는 동안 실행되므로, `DATABASE_URL`이나 `JWT_SECRET_KEY`가 없으면
첫 HTTP 요청이 오기 전에 프로세스가 죽는다. 요청 핸들러 안에서 처음 읽는
설계였다면 그 실패는 그 라우트를 처음 두드린 클라이언트가 목격했을 것이다.

## 왜 라우트를 배열에 손으로 등록하는가

`src/config/routes.module.ts`의 `@Module({ controllers: [...] })` 배열이 공개
라우트의 유일한 등록 지점이다. 디렉터리를 훑어 `@Controller`를 자동으로 찾는
방식을 두지 않는다 — 이 배열에 없으면 그 컨트롤러의 라우트는 존재하지 않는
것과 같다는 것을 이 파일 하나만 보고 알 수 있어야 하고, ESM + tsc 빌드에서
glob 경로 탐색은 `src/`와 `dist/`가 갈라지는 흔한 실패원이기도 하다.

## `AppModule`의 그래프에 넣으면 안 되는 것 — broker

`src/config/broker.ts`는 BullMQ/Redis 연결 설정을 갖지만, 이것을 import하는
것은 `src/app/jobs/queue.ts`(생산자)와 `src/app/jobs/worker.ts`(워커) 둘뿐이다 —
둘 다 `AppModule`의 provider 그래프 밖에 있다. `src/config/app.module.ts`나 그
그래프가 닿는 어디에든 Bull 등록(예: `BullModule.forRootAsync`)을 넣으면 API
프로세스 전체가 Redis를 요구하게 된다.

이것은 짐작이 아니라 실측이다. `test/app-factory.ts`가 모든 테스트 앱의 유일한
조립 지점으로 `AppModule`을 통째로 import하기 때문에, 실제로 그 등록을 넣고
돌려 보니 job과 전혀 무관한 `health.controller.spec.ts`의 테스트 11개 중 10개가
Redis 연결 실패로 즉시 깨졌다. `broker.ts`나 `AppModule`을 고칠 때는 이 경계를
넘지 않았는지 — 즉 `app.module.ts`나 `routes.module.ts`가 `broker.ts`를
(직접이든 간접이든) import하게 되지 않았는지 — 확인한다. README의 환경 변수
표가 "API는 이 값을 읽지 않습니다 — broker를 import하지 않으므로 Redis 없이도
뜹니다"라고 적은 것이 바로 이 경계다.

## `data-source.ts`가 CLI 전용으로 따로 있는 이유

`typeorm migration:run` 같은 CLI 명령은 Nest 애플리케이션을 조립하지 않고
`src/config/data-source.ts`의 default export를 직접 읽는다. 이 인스턴스는
애플리케이션이 `TypeOrmModule.forRootAsync`로 만드는 것과는 별개이지만, 둘 다
같은 `buildDataSourceOptions`(`src/config/database.ts`)를 지나므로 CLI가 보는
스키마와 앱이 보는 스키마가 갈라질 수 없다 — 옵션 조립 로직을 두 곳에 따로
쓰면 그중 하나만 고쳐지는 날이 온다.

## 함께 고쳐야 하는 파일

- **필수 환경 변수를 추가하거나 기존 변수의 필수 여부를 바꿀 때.**
  `src/config/settings.ts`의 로더와 `README.md`의 환경 변수 표를 같은 커밋에서
  바꾼다. `test/docs/readme.spec.ts`는 미리 정해 둔 필수 변수 이름 집합만
  검사하므로, 새 변수를 그 집합에 추가하는 것을 잊어도 게이트는 그대로
  초록이다 — Phase 7이 `TEST_REDIS_URL`을 표에서 빠뜨린 채로 넘어갔던 경로가
  정확히 이것이다.
- **`src/app/models/index.ts`의 `ENTITIES`나 `src/db/migrations/index.ts`의
  `MIGRATIONS`가 늘어날 때.** `src/config/database.ts`의 `buildDataSourceOptions`가
  두 배열을 그대로 `DataSourceOptions`에 옮기므로 보통은 이 조립 지점을 따로
  고칠 필요가 없다 — 다만 그 배선 자체(필드 이름, `synchronize`·`migrationsRun`
  값)를 바꿀 때는 CLI(`data-source.ts`)와 앱(`app.module.ts`)이 여전히 같은
  옵션을 받는지 함께 확인한다.
- **라우트를 추가하거나 컨트롤러 경로를 바꿀 때.** `src/config/routes.module.ts`의
  `controllers` 배열, 해당 컨트롤러의 `@Controller` 경로, 그 컨트롤러가 쓰는
  시리얼라이저의 `resourcePath`(`src/app/serializers/`) 세 곳이 같은 문자열을
  가리켜야 한다. `src/app/controllers/concerns/crud-actions.ts`가 뒤 두 개의
  불일치를 조립 시점에 던져 주지만, 배열에 컨트롤러를 추가하는 것 자체는 그
  검사 밖이다 — 추가를 잊으면 나머지 넷을 다 갖췄어도 라우트는 조용히
  존재하지 않는다.
