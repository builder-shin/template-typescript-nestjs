<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/db

## 목적

실제 PostgreSQL을 쓰는 스위트에 URL 검증·마이그레이션·롤백·잠금 fixture를 제공한다.
이 디렉터리의 spec 파일은 연결 없이 fixture 입력과 마이그레이션·시드 선언을 검사한다.

## 주요 파일

| 파일                                                 | 설명                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [fixture.ts](fixture.ts)                             | 테스트 DB·Redis URL, 마이그레이션 잠금·준비, 커밋 잠금 손잡이, DataSource와 withRollback을 제공한다. |
| [fixture.spec.ts](fixture.spec.ts)                   | DB 이름의 _test 접미사·단일 경로 세그먼트, URL 누락·형식과 Redis 검증의 한계를 검사한다.             |
| [migration-naming.spec.ts](migration-naming.spec.ts) | 마이그레이션 파일·클래스 시각, 명시 등록 수, up/down 메서드 존재를 검사한다.                         |
| [seeds.spec.ts](seeds.spec.ts)                       | 시드 실행 진입점 isDirectRun이 POSIX·Windows 경로와 import를 구별하는지 검사한다.                    |

## AI 에이전트 지침

- requireTestDatabaseUrl의 이름·경로 검사를 우회하지 않는다. fixture는 실제
  마이그레이션을 실행하며 일부 통합 작업은 만료 세션 전체에 닿는다.
- requireTestRedisUrl은 URL 유효성만 확인한다. 테스트 전용 Redis 선택은 환경 구성의
  책임이며 개발 Redis를 구분해 주는 안전 검사로 설명하지 않는다.
- withMigrationLock은 전용 QueryRunner로 같은 세션에서 잠그고 해제한다.
  ensureMigrated는 앱 조립 전에 임시 풀로 스키마를 준비하고 닫으며,
  createTestDataSource는 호출자가 닫아야 할 DataSource를 돌려준다.
- withRollback(dataSource, fn)은 성공해도 항상 롤백하며 매니저를 콜백에 넘긴다.
  다른 연결이 커밋한 행을 가리지는 않으므로 조회를 자기 id 집합으로 좁힌다.
- acquireCommitLock은 참여 스위트끼리만 직렬화한다. 커밋 행·전체 테이블 연산의
  경합 판단과 손잡이 해제는 [상위 가이드](../AGENTS.md)를 따른다.
- 마이그레이션의 down 존재 검사는 실제 복구의 증거가 아니다. 적용·스키마 드리프트·
  되돌리기와 시드 멱등성은 [통합 검사](../integration/AGENTS.md)에서 확인한다.

## 검증

첫 명령은 외부 서비스 없이 실행한다. 두 번째는 integration까지 포함하므로 테스트
PostgreSQL·Redis와 TEST_DATABASE_URL·TEST_REDIS_URL을 준비한 뒤 실행한다.

```bash
pnpm test:quick --runInBand test/db
pnpm test:db --runInBand
```

## 의존성

src/config/database.ts, src/db/migrations의 명시 등록 배열과 src/db/seeds.ts에 의존한다.
Jest, TypeORM·PostgreSQL과 Node URL·파일 API를 사용한다. Redis URL 검증 자체는
Redis 연결을 열지 않는다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
