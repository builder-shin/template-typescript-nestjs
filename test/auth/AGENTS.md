<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# test/auth

## 목적

비밀번호 해시와 JWT의 발급·검증 계약을 DB 없이 검사한다. 세션 저장과 Bearer 사용자의
DB 조회는 [통합 검사](../integration/AGENTS.md)가 담당한다.

## 주요 파일

| 파일                                                         | 설명                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [password.spec.ts](password.spec.ts)                         | argon2id·솔트, 정상/오류 비밀번호, 손상된 해시와 더미 검증 비용을 검사한다.         |
| [password-dummy-cache.spec.ts](password-dummy-cache.spec.ts) | 최초 더미 해시 생성이 실패한 뒤 다음 호출이 다시 시도하는지 검사한다.               |
| [tokens.spec.ts](tokens.spec.ts)                             | access/refresh 구분, 서명·issuer·audience·클레임, 만료 오류와 유예 시간을 검사한다. |

## AI 에이전트 지침

- 더미 캐시 회귀는 별도 파일에 둔다. Jest의 파일별 모듈 레지스트리 격리가 최초 호출의
  빈 캐시를 보장하므로 다른 비밀번호 테스트에 합치면 검사 전제가 달라진다.
- 실제 argon2와 JwtService를 사용한다. 비밀번호 불일치의 false와 손상된 해시의 예외를
  구분하고, JWT 거부는 상태 코드뿐 아니라 JSON:API 오류 코드도 확인한다.
- 토큰 종류 검사에서 다른 필수 클레임 누락이 먼저 실패하지 않도록 유효한 서명과
  필요한 클레임을 만든 뒤 검사 대상 하나만 바꾼다.
- Date.now 또는 argon2.hash를 교체했다면 finally에서 원래 값을 복원한다.
  ESM Jest 전역과 상태 복원 규칙은 [상위 가이드](../AGENTS.md)를 따른다.

## 검증

저장소 루트에서 실행한다. 외부 서비스는 필요 없으며 argon2 연산은 실제로 수행한다.

```bash
pnpm test:quick --runInBand test/auth
pnpm typecheck
```

## 의존성

내부 대상은 src/app/auth의 password.ts·tokens.ts와 JSON:API 오류, JWT 설정 타입이다.
외부로 Jest, argon2, @nestjs/jwt를 사용한다.

<!-- MANUAL: 이 줄 아래의 수동 메모는 재생성 시 보존한다. -->
