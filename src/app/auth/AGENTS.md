<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/auth

## 목적

비밀번호 해시, JWT 서명·검증, 활성 사용자 인증과 refresh session 수명을 담당합니다.
HTTP 라우트는 `../controllers/api/v1/`에서 이 기능을 조립합니다.

## 주요 파일

| 파일                    | 설명                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| `password.ts`           | argon2 해시·검증과 존재하지 않는 계정용 지연 생성 더미 해시 캐시.       |
| `tokens.ts`             | `TokenService`, 설정 주입 토큰, access·refresh 종류 및 JWT 클레임 검증. |
| `current-user.guard.ts` | Bearer 토큰으로 활성 사용자를 찾는 가드와 `CurrentUser` 데코레이터.     |
| `refresh-session.ts`    | 세션 발급, 행 잠금 아래 회전, 멱등 폐기.                                |

## AI 에이전트 지침

- `rotateSession`은 호출자가 연 트랜잭션의 `EntityManager`를 받습니다. 같은 세션의
  `FOR UPDATE` 잠금, 활성 사용자 재확인, 새 세션 생성과 옛 세션 폐기를 유지합니다.
- `authenticateRequest`도 `EntityManager`를 받습니다. 테스트의 미커밋 사용자가
  보이도록 같은 트랜잭션 매니저를 전달합니다.
- 가드는 인증 누락·잘못된 토큰·만료·비활성을 각 카탈로그 코드로 구분합니다. UUID
  모양을 DB 조회 전에 확인하는 경로를 유지합니다.
- `CurrentUser`는 `JwtActiveUserGuard`가 붙인 사용자만 읽습니다. 데코레이터만 쓰면
  선언 오류로 `TypeError`가 납니다.
- JWT 검증은 서명·issuer·audience·만료·`typ`를 확인합니다. access와 refresh 토큰을
  혼용하지 않습니다. `jsonwebtoken` 대신 직접 의존성인 `@nestjs/jwt`를 사용합니다.
- 로그인에서 없는 계정도 비밀번호 검증 비용을 치릅니다. 더미 해시 생성 실패 시 캐시를
  비워 다음 호출이 재시도하게 하는 계약을 보존합니다.

## 테스트

저장소 루트에서 `pnpm typecheck`와 `pnpm test:quick --runInBand test/auth`를 실행합니다.
가드·회전·HTTP 변경은 PostgreSQL과 `TEST_DATABASE_URL`을 준비한 뒤 다음을 실행합니다.

```bash
pnpm test:quick --runInBand test/integration/current-user.guard.spec.ts test/integration/refresh-session.spec.ts test/integration/refresh-session-concurrency.spec.ts test/integration/auth-api.spec.ts test/integration/users-me.spec.ts
```

동시 회전은 별도 커넥션의 실제 트랜잭션으로 검증합니다. fixture와 정리는
[test/AGENTS.md](../../../test/AGENTS.md)를 따릅니다.

## 의존성

`../models/`의 User·RefreshSession, `../jsonapi/`의 오류 카탈로그,
`../controllers/concerns/relationship-resolver.ts`의 ID 판정, `../../config/settings.ts`의
JWT 설정을 사용합니다. 외부 의존성은 NestJS JWT, argon2, TypeORM입니다.

<!-- MANUAL: 아래에 추가한 수동 메모는 재생성 시 보존합니다. -->
