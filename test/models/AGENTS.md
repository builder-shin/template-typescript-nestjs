<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/models

## 목적

TypeORM 데코레이터 메타데이터로 엔티티의 명시 등록과 저장 구조 선언을 검사한다.
DataSource를 초기화하지 않으므로 실제 테이블·제약 동작은 통합 검사에서 확인한다.

## 주요 파일

| 파일                                 | 설명                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| [entities.spec.ts](entities.spec.ts) | ENTITIES의 다섯 엔티티, 테이블·컬럼·상태 enum·관계 cardinality와 주요 인덱스 선언을 고정한다. |

## AI 에이전트 지침

- 새 엔티티는 src/app/models/index.ts의 ENTITIES 등록과 이 테스트 기대값을 함께
  갱신한다. 파일이 존재해도 등록 배열 밖의 엔티티는 운영 DataSource가 알지 못한다.
- 컬럼 이름은 TypeORM의 명시 name 또는 propertyName을 읽고, 관계는 대상 클래스와
  프로퍼티로 좁힌다. 다른 엔티티의 메타데이터를 대신 확인하지 않는다.
- 인덱스 columns는 배열과 선택자 함수의 유니온이다. 배열인지 실제로 좁힌 뒤 검사하며
  타입 캐스트만으로 배열이라고 가정하지 않는다.
- 메타데이터 검사를 통과해도 마이그레이션이 같은 스키마를 만드는지는 별개다.
  [migrations.spec.ts](../integration/migrations.spec.ts)의 스키마 드리프트 검사도
  수행한다. DB 변경 규칙은 [상위 가이드](../AGENTS.md)와 루트 계약을 따른다.

## 검증

첫 명령에는 외부 서비스가 필요 없다. 저장 스키마를 바꿨다면 테스트 PostgreSQL을
준비한 뒤 두 번째 명령으로 실제 마이그레이션과 대조한다.

```bash
pnpm test:quick --runInBand test/models
pnpm test:quick --runInBand --runTestsByPath test/integration/migrations.spec.ts
```

## 의존성

src/app/models의 Example·Category·Tag·User·RefreshSession 및 ENTITIES에 의존한다.
Jest, TypeORM의 getMetadataArgsStorage와 테스트 setup의 reflect-metadata를 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
