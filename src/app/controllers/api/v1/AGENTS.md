<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/controllers/api/v1

## 목적

`/api/v1`의 자원·인증 라우트를 선언합니다. Example은 공통 `CrudActions`를 사용하고,
인증과 자기 사용자 조회는 공통 파싱·응답 함수를 활용해 라우트를 직접 정의합니다.

## 주요 파일

| 파일                       | 설명                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `examples.controller.ts`   | Example CRUD·PUT·관계 쓰기를 선언하고 활성 사용자 쓰기 가드를 지정. |
| `categories.controller.ts` | `enableWrites: false`인 분류 목록·단건 조회.                        |
| `tags.controller.ts`       | `enableWrites: false`인 라벨 목록·단건 조회.                        |
| `auth.controller.ts`       | 가입·로그인·refresh 회전·logout과 인증 응답 조립.                   |
| `users.controller.ts`      | Bearer 인증된 사용자의 `GET /api/v1/users/me` 응답.                 |

## AI 에이전트 지침

- 자원 컨트롤러는 모델·스키마·정책·시리얼라이저를 선언으로 연결합니다. CRUD 구현은
  `../../concerns/`, 공개 등록은 `../../../../config/routes.module.ts`가 소유합니다.
- Example의 읽기는 공개이고 쓰기·관계 mutation은 `JwtActiveUserGuard`를 요구합니다.
  `writeGuards`는 생략 시 빈 배열입니다. 새 쓰기 자원에 명시적으로 지정합니다.
- 분류·라벨은 서버 관리 참조 데이터입니다. 읽기만 열고 JSON:API type은 각각
  `exampleCategories`·`exampleTags`를 유지합니다. URL 경로와 type은 다른 값입니다.
- `enableUpsert`에는 `replaceSchema`를 함께 지정합니다. PUT은 생성 시 201과 Location,
  교체 시 200을 반환하고 생략한 소유 필드·관계를 되돌립니다.
- 인증 라우트는 관계 입력을 공통 오류로 거부합니다. 가입 중복은 사전 조회 대신
  `UQ_users_email`의 23505 위반만 409로 옮깁니다.
- 로그인은 비밀번호 확인 후 활성 상태를 검사하고, 없는 계정도 더미 해시를 검증합니다.
  refresh 회전 전체는 한 트랜잭션으로 묶습니다.
- logout은 제시된 refresh 세션 하나를 폐기해 204를 반환합니다. 이미 발급된 access
  token은 만료까지 유효합니다. 토큰 응답 수명은 설정 초 값을 그대로 전달합니다.
- `users/me`는 읽기지만 인증이 필요하므로 메서드 가드와 `ApiBearerAuth`를 직접
  붙입니다. ID 기반 사용자 조회를 가정해 시리얼라이저 링크를 만들지 않습니다.

## 테스트

저장소 루트에서 `pnpm typecheck`를 실행합니다. 실제 PostgreSQL과 `TEST_DATABASE_URL`을
준비한 뒤 변경한 라우트의 스위트를 실행합니다.

```bash
pnpm test:quick --runInBand test/integration/examples-api.spec.ts test/integration/examples-put.spec.ts test/integration/reference-resources.spec.ts test/integration/auth-api.spec.ts test/integration/users-me.spec.ts
```

라우트 등록·보안 표시 변경에는
`pnpm test:quick --runInBand test/config/routes.module.spec.ts test/config/openapi.spec.ts`도
실행합니다. 이 HTTP 검사들도 PostgreSQL을 사용합니다. 커밋된 행의 정리는
[test/AGENTS.md](../../../../../test/AGENTS.md)의 규칙을 따릅니다.

## 의존성

`../../../models/`, `../../../schemas/`, `../../../serializers/`, `../../../auth/`와
공통 concern을 사용합니다. 외부 의존성은 NestJS, Swagger와 TypeORM입니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
