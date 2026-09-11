<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# db 안내

## 목적

결정적 시드와 스키마 변경 이력을 관리합니다. 시드는 기존 스키마 위에 선언한 데이터 상태를 적용합니다.

## 주요 파일

| 파일       | 설명                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `seeds.ts` | 고정 UUID, upsert와 관계 재구성으로 시드 상태를 적용하며 직접 실행 시 트랜잭션과 연결을 소유합니다. |

## 하위 디렉터리

| 디렉터리      | 역할                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `migrations/` | 명시 등록된 스키마 변경과 역변경. [migrations/AGENTS.md](migrations/AGENTS.md) 참고. |

## 작업·검증 지침

- `seed(manager)`는 호출자가 전달한 트랜잭션을 사용하며 자체 commit/rollback을 하지 않습니다.
- 시드 행과 관계는 고정 식별자로 좁혀 검사합니다. 다른 테스트의 커밋 행을 지우거나 세지 않습니다.
- 저장소 루트에서 `pnpm test:quick --runInBand test/db/seeds.spec.ts`로 실행 진입점 판정을 확인합니다.
- 전용 `TEST_DATABASE_URL`을 설정하고 `pnpm test:quick --runInBand test/integration/seeds.spec.ts`로
  재실행·보정·트랜잭션 계약을 확인합니다. 전체 준비/정리는 `./scripts/check.sh`가 담당합니다.
- CLI 검사는 `pnpm build` 후 명시한 대상 DB 환경에서 `pnpm seed`를 실행합니다.

## 의존성

`src/app/models/`의 Category/Tag/Example, `src/config/database.ts`와 설정 로더,
TypeORM EntityManager/DataSource 및 Node URL API를 사용합니다.

<!-- MANUAL: 기존 main의 상세 계약을 보존합니다. 이 줄 아래는 자동 재생성하지 않습니다. -->

# src/db/ — 결정적 시드

이 디렉터리는 시드 데이터를 소유한다. 스키마는 `src/db/migrations/`가 소유한다 —
이 문서는 스키마가 이미 있다고 전제한다.

## 시드가 결정적이어야 하는 이유

시드는 "없으면 만든다"는 보정이 아니라 "이 상태여야 한다"는 선언이다. 배포
절차는 같은 시드를 몇 번이고 다시 돌릴 수 있어야 안전하므로, `src/db/seeds.ts`는
이것을 세 가지 장치로 보장한다.

- **고정 UUID.** `SEED_CATEGORY_IDS`·`SEED_TAG_IDS`·`SEED_EXAMPLE_IDS`가
  각 행의 id를 리터럴로 못박는다. 테이블 쪽 `DEFAULT gen_random_uuid()`에
  맡기면 실행마다 다른 행이 태어나 "두 번째 실행"이라는 것 자체가 의미를 잃는다.
- **PostgreSQL upsert(`ON CONFLICT` 기반 `orUpdate`).** 같은 id가 이미 있으면
  선언한 컬럼 값으로 덮어쓴다. 그래서 시드 실행 뒤 손으로 고친 행이 있어도
  다음 시드가 선언 값으로 되돌린다 — "결정적"은 "다시 돌리면 항상 선언대로
  돌아온다"는 뜻이지 "기존 행을 건드리지 않는다"는 뜻이 아니다.
- **변경 없는 행과 추가 관계를 보존한다.** upsert는 값이 달라질 때만 갱신하여
  `updated_at`을 유지한다. `example_tags`는 `ON CONFLICT DO NOTHING`으로
  선언된 관계를 보충하고 사용자가 추가한 관계를 삭제하지 않는다.

## 트랜잭션은 호출자가 소유한다

`seed(manager: EntityManager)`는 트랜잭션을 스스로 열지 않는다.
`test/integration/seeds.spec.ts`는 롤백되는 트랜잭션 안에서 `seed()`를 불러
흔적을 남기지 않고, CLI 진입점 `main()`은 `dataSource.transaction(...)`으로
자기 트랜잭션을 열어 도중 실패 시 전부 되돌린다. 시드 함수 자신이 트랜잭션을
소유했다면 테스트는 그 결과를 롤백할 방법이 없다 — 커밋해 버리는 시드는 테스트
DB를 실행할 때마다 오염시킨다.

## `isDirectRun`이 문자열을 직접 이어붙이지 않는 이유

`node dist/db/seeds.js`로 직접 실행했을 때만 `main()`이 돌게 하는 판정
(`isDirectRun`)은 `file://${argv1}` 같은 문자열 결합을 쓰지 않는다.
Windows 경로(`C:\Users\...`)의 드라이브 문자 뒤 콜론과 백슬래시는 그렇게
이어붙여도 유효한 `file://` URL이 되지 않아, 이 비교가 Windows에서 항상
거짓이었다 — `pnpm seed`가 아무 일도 하지 않고 조용히 종료 코드 0으로 끝나는,
실행은 됐지만 아무것도 하지 않은 상태였다.

지금은 `pathToFileURL`로 변환하고 `argv1`의 드라이브 문자 유무로 Windows/POSIX
규칙을 명시적으로 골라 넘긴다 — 실행 중인 호스트의 `process.platform`에
기대지 않으므로, 이 판정 함수와 그것을 검증하는 `test/db/seeds.spec.ts`가
Windows 개발 머신과 Linux CI 중 어느 쪽에서 돌든 같은 값을 낸다. 진입점 판정을
고칠 일이 생기면 문자열 결합으로 "단순화"하고 싶은 유혹이 정확히 이 버그를
다시 부른다는 것을 기억한다.

## 함께 고쳐야 하는 파일

- **새 시드 행이나 관계를 추가할 때.** `CATEGORIES`/`TAGS`/`EXAMPLES` 배열에
  항목을 더하면서, 그 항목이 참조하는 컬럼과 제약이 이미 적용된 마이그레이션
  (`src/db/migrations/`) 스키마 위에서 유효한지 확인한다 — 시드는 스키마를
  만들지 않고 그 위에 행을 올릴 뿐이다.
- **`SEED_CATEGORY_IDS`/`SEED_TAG_IDS`/`SEED_EXAMPLE_IDS`를 참조하는 테스트를
  추가할 때.** `test/integration/seeds.spec.ts`는 이 상수들로 좁힌 `id In(...)`
  조건을 쓴다 — 스코프 없는 `count()`는 다른 스위트가 커밋한 행까지 세어
  흔들리므로, 시드가 선언한 개수를 확인하려는 새 테스트도 같은 방식으로 좁힌다.
