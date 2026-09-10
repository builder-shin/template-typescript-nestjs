<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/models

## 목적

TypeORM 엔티티, 컬럼, 제약, 인덱스와 관계를 선언합니다. HTTP 입력 검증은
`../schemas/`, 공개 필드 선택은 `../serializers/`가 담당합니다.

## 주요 파일

| 파일                        | 설명                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `index.ts`                  | 엔티티 export와 DataSource가 소비하는 명시적 `ENTITIES` 배열.         |
| `example.entity.ts`         | 상태 enum·점수 범위, 정렬 인덱스, 분류 및 라벨 관계를 가진 견본 자원. |
| `category.entity.ts`        | 고유 이름을 가진 분류와 Example 역관계.                               |
| `tag.entity.ts`             | 고유 이름을 가진 라벨과 Example 다대다 역관계.                        |
| `user.entity.ts`            | 이메일, 비밀번호 해시, 활성 상태를 저장하는 인증 주체.                |
| `refresh-session.entity.ts` | 사용자별 세션 만료·폐기·교체 연결과 정리용 인덱스.                    |

## AI 에이전트 지침

- 새 엔티티는 `ENTITIES`에 손으로 등록합니다. 스키마 변경은
  `../../db/migrations/`의 새 마이그레이션으로 전달하며 적용된 파일을 수정하지 않습니다.
- 제약·인덱스·FK 이름은 실제 마이그레이션과 일치시킵니다. 자동 생성 이름을 사용하는
  기존 unique·조인 인덱스는 마이그레이션의 실제 이름을 확인한 뒤 변경합니다.
- `Example`이 `example_tags` 조인 테이블을 소유합니다. 양쪽 관계의 CASCADE 선언을
  맞추고, 역참조의 문자열 대상과 `import type`으로 순환 import를 피합니다.
- nullable 변경은 DTO의 `IsOptional`·`ValidateIf` 선택과 함께 검토합니다. 내부 FK나
  비밀번호 해시는 공개 attributes에 추가하지 않습니다.
- 조회 정책에서 filter·sort를 열면 인덱스 필요 여부를 같은 변경에서 판단합니다.
  refresh session의 `replacedById` 인덱스는 삭제 cascade의 접근 경로도 담당합니다.

## 테스트

저장소 루트에서 `pnpm typecheck`와 `pnpm test:quick --runInBand test/models`를 실행합니다.
스키마 변경은 PostgreSQL과 `TEST_DATABASE_URL`을 준비하여 다음으로 검증합니다.

```bash
pnpm test:quick --runInBand test/integration/migrations.spec.ts test/integration/auth-schema.spec.ts test/integration/migration-revert.spec.ts
```

스키마 드리프트·실제 FK 동작은 DB 없는 메타데이터 검사만으로 확인되지 않습니다.
fixture 규칙은 [test/AGENTS.md](../../../test/AGENTS.md)를 봅니다.

## 의존성

TypeORM 데코레이터와 PostgreSQL enum·UUID·timestamptz를 사용합니다. 런타임 등록은
`../../config/database.ts`, 스키마 전달은 `../../db/migrations/`와 연결됩니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
