<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/integration

## 목적

실제 PostgreSQL의 제약·조회·트랜잭션·동시성과 애플리케이션 HTTP 계약을 검증한다.
Redis 가용성과 BullMQ 큐·워커 계약도 이곳에 있으며, 필요한 서비스는 스위트별로 다르다.

## 주요 파일

| 파일                                                                                   | 설명                                                                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [migrations.spec.ts](migrations.spec.ts)                                               | 마이그레이션 적용, enum·인덱스·제약, 엔티티 스키마 드리프트와 QueryPolicy를 대조한다.           |
| [migration-revert.spec.ts](migration-revert.spec.ts)                                   | 전용 스키마에서 up/down을 실행해 테이블·enum·인덱스가 제거되는지 검사한다.                      |
| [seeds.spec.ts](seeds.spec.ts)                                                         | 고정 id, 멱등 실행, 속성·관계 복원과 호출자 트랜잭션 소유권을 검사한다.                         |
| [query-compiler.spec.ts](query-compiler.spec.ts)                                       | 실제 SQL의 필터·정렬·include, offset/cursor 이동, 총 개수·정밀도·입력 거부를 검사한다.          |
| [relationship-resolver.spec.ts](relationship-resolver.spec.ts)                         | linkage를 실제 관계 행으로 해석하고 null·빈 배열·중복·없는 대상·잘못된 type/id를 검사한다.      |
| [upsert-executor.spec.ts](upsert-executor.spec.ts)                                     | 요청 키 기반 교체값, 생성·갱신 SQL과 세션별 advisory 잠금의 획득·해제를 검사한다.               |
| [crud-transaction.spec.ts](crud-transaction.spec.ts)                                   | 저장 후 훅 또는 재조회·직렬화가 실패하는 프로브로 create·PUT 롤백과 내부 오류 은닉을 검사한다.  |
| [examples-api.spec.ts](examples-api.spec.ts)                                           | Example CRUD·관계 HTTP, 조회·오류·협상·쓰기 인증을 실제 DB와 함께 검사한다.                     |
| [examples-put.spec.ts](examples-put.spec.ts)                                           | PUT의 201+Location·200 교체, 기본값·관계 reset, id·필수값 오류와 동일 id 동시 요청을 검사한다.  |
| [reference-resources.spec.ts](reference-resources.spec.ts)                             | Category·Tag의 공개 읽기, name 필터·정렬·커서·self 링크와 쓰기 미노출을 검사한다.               |
| [auth-schema.spec.ts](auth-schema.spec.ts)                                             | 사용자 이메일 UNIQUE, 세션 FK, 사용자 삭제 cascade와 replacedBy 삭제 시 SET NULL을 검사한다.    |
| [current-user.guard.spec.ts](current-user.guard.spec.ts)                               | 실제 사용자 조회로 Bearer 헤더·토큰·활성 여부·잘못된 UUID의 인증 오류를 검사한다.               |
| [refresh-session.spec.ts](refresh-session.spec.ts)                                     | 세션 발급·회전·만료·폐기·멱등성과 잘못된 세션 식별자 처리를 검사한다.                           |
| [refresh-session-concurrency.spec.ts](refresh-session-concurrency.spec.ts)             | 별도 트랜잭션 둘이 같은 세션을 회전할 때 한 번만 성공하는지 검사한다.                           |
| [auth-api.spec.ts](auth-api.spec.ts)                                                   | 가입·로그인·갱신·로그아웃 HTTP, 비밀번호·계정 오류·토큰 응답과 관계 입력 거부를 검사한다.       |
| [users-me.spec.ts](users-me.spec.ts)                                                   | 로그인 후 자기 사용자 조회와 토큰 없는 요청의 401을 검사한다.                                   |
| [process-example.spec.ts](process-example.spec.ts)                                     | 없는·잘못된 id의 경고, 정상 행 보존, DB 오류 전파를 검사한다.                                   |
| [purge-refresh-sessions.spec.ts](purge-refresh-sessions.spec.ts)                       | 만료 보존 기간, 배치 SQL 정렬·횟수, 옵션 검증과 자기참조 FK 동작을 검사한다.                    |
| [purge-refresh-sessions-contention.spec.ts](purge-refresh-sessions-contention.spec.ts) | 두 연결로 SKIP LOCKED·cascade 잠금 타임아웃·배치별 커밋을 검사한다.                             |
| [job-dispatch.spec.ts](job-dispatch.spec.ts)                                           | 잡 이름이 실제 PostgreSQL 핸들러로 분배되는지 로그·삭제 결과로 검사하고 미지의 이름을 거부한다. |
| [redis-fixture.spec.ts](redis-fixture.spec.ts)                                         | TEST_REDIS_URL의 Redis에 직접 PING하고 연결을 닫는다.                                           |
| [jobs-queue.spec.ts](jobs-queue.spec.ts)                                               | 실제 Redis 큐의 attempts 옵션·총 시도 횟수와 PostgreSQL 행을 읽는 워커 처리를 검사한다.         |

## AI 에이전트 지침

### 서비스와 조립

- redis-fixture는 Redis만, jobs-queue는 PostgreSQL과 Redis를 모두 사용한다.
  나머지 스위트는 PostgreSQL을 사용한다. process-example·job-dispatch·purge 검사는
  핸들러를 직접 호출하므로 Redis가 필요 없다.
- DB 스위트는 createTestDataSource 또는 createTestApp을 통해 스키마를 스스로
  준비한다. 다른 Jest 워커가 먼저 마이그레이션할 것이라고 기대하지 않는다.
- 전체 앱은 [app-factory.ts](../app-factory.ts)를 사용한다. crud-transaction의
  별도 프로브는 저장 후 실패를 주입하는 테스트이므로 운영 컨트롤러 대신 조립한다.
- worker.ts는 import하면 실제 연결과 시그널 핸들러를 등록한다. dispatchJob과
  BullMQ의 명시적 Queue·Worker 조립으로 테스트의 수명을 제어한다.

### 격리와 회귀

- 기본 fixture는 withRollback(dataSource, fn)이다. 콜백의 EntityManager를 대상
  함수에 그대로 전달해야 미커밋 행을 같은 트랜잭션에서 볼 수 있다.
- 롤백은 다른 스위트가 커밋한 행을 가리지 않는다. query-compiler와 seeds의
  id 집합으로 좁힌 조회·count 패턴을 유지한다.
- HTTP·동시성·purge처럼 커밋이 필요한 테스트는 자기 id·이메일 접두사만 정리한다.
  TRUNCATE·조건 없는 DELETE·Redis FLUSHALL을 정리 수단으로 쓰지 않는다.
- 테이블 전체 조회·삭제가 겹치는 커밋 스위트는 acquireCommitLock에 참여한다.
  examples-api·examples-put·reference-resources와 Example 행을 만드는 jobs-queue
  검사가 한 그룹이며, purge 두 스위트와 해당 잡을 실행하는 job-dispatch도 참여한다.
  잠금은 참여자끼리만 보호하며, 모든 스위트에 무조건 추가하지 않는다.
- auth-api·users-me·refresh-session-concurrency는 자기 사용자 범위만 다루고
  유효기간이 충분히 남은 세션을 쓰므로 위 잠금을 잡지 않는다. HTTP 팩토리의
  refresh 수명 30일 고정을 앰비언트 환경 값으로 줄이지 않는다.
- migration-revert는 public을 지우지 않고 전용 스키마·search_path로 격리한다.
  pgcrypto 준비만 공통 마이그레이션 잠금에 참여한다.
- upsert 입력은 plainToInstance와 원본 키의 Set을 함께 만든다. 잠금 단언은
  pg_locks를 자기 backend pid로 좁히며, 동시성은 서로 다른 연결·트랜잭션으로 만든다.
- 저장 전에 실패하는 테스트는 저장 후 롤백의 증거가 아니다. crud-transaction의
  afterSave 및 직렬화 실패 경로를 유지한다.
- BullMQ 공유 jobs 큐는 자신이 넣은 job.remove만 수행한다. 테스트 전용 큐만
  obliterate하고, 완료 리스너는 enqueue 전에 등록한 뒤 자기 job.id로 좁힌다.
- 실패한 초기화 뒤의 정리도 원래 오류를 가리지 않게 작성하고, 앱·DataSource·
  QueryRunner·Worker·Queue·Redis 연결과 잠금 손잡이를 해제한다.
  자세한 배경은 [상위 가이드](../AGENTS.md)의 보존 계약을 읽는다.

## 검증

저장소 루트 기준이다. 첫 두 명령은 TEST_DATABASE_URL·TEST_REDIS_URL과 실제 테스트
서비스를 먼저 준비해야 한다. DB 이름은 _test로 끝나야 하며 Redis도 테스트 전용을 쓴다.

```bash
pnpm test:quick --runInBand test/integration
pnpm test:db --runInBand
./scripts/check.sh
```

전체 게이트는 Bash를 사용하며, 주어지지 않은 서비스 URL은 Docker로 준비한다.
스키마 준비 경로를 변경했다면 빈 테스트 DB에서 해당 HTTP 스위트 하나를 단독 실행해
다른 워커의 도움 없이 통과하는지도 확인한다.

## 의존성

src/app의 controllers·auth·jobs·jsonapi·models·schemas·serializers, src/db의
마이그레이션·시드와 테스트 fixture에 의존한다. Jest, Nest Testing, Supertest,
TypeORM·PostgreSQL, class-transformer 및 일부 스위트의 BullMQ·ioredis를 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
