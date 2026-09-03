import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

/**
 * 인증 라우트의 쓰기 계약.
 *
 * 이메일을 소문자로 정규화하는 지점은 여기 하나뿐이다. 엔티티나 컨트롤러에서 또 하면
 * 두 곳이 갈릴 수 있고, 갈리는 순간 대소문자만 다른 두 계정이 생긴다 — 유니크 제약으로
 * 되돌릴 수 없는 상태다.
 *
 * 길이 320은 RFC 5321의 이메일 최대 길이이고 컬럼과 같다. 스키마가 더 느슨하면
 * 사용자 입력 오류가 422가 아니라 500으로 나간다.
 */

/** 이메일을 소문자로 접는다. 문자열이 아니면 그대로 넘겨 검증기가 판정하게 둔다. */
function toLowerCase({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

/** `POST /api/v1/auth/register`의 본문 attributes. */
export class UserRegister {
  @Transform(toLowerCase)
  @IsEmail()
  @Length(3, 320)
  email!: string;

  // 스펙 9장이 정한 12~128자.
  @IsString()
  @Length(12, 128)
  password!: string;
}

/**
 * `POST /api/v1/auth/login`의 본문 attributes.
 *
 * 가입과 달리 길이 정책을 강제하지 않는다. 정책이 나중에 강해지면 그 전에 가입한
 * 사용자가 로그인조차 못 하게 되고, 길이 위반을 422로 알려 주는 것은 공격자에게
 * 정책을 알려 주는 일이다. 상한만 둔다 — 무한히 긴 문자열을 해시하게 두면 그것이
 * 곧 부하 공격이다.
 */
export class AuthCredentials {
  @Transform(toLowerCase)
  @IsEmail()
  @Length(3, 320)
  email!: string;

  @IsString()
  @Length(1, 1024)
  password!: string;
}

/**
 * `POST /api/v1/auth/refresh`와 `/logout`의 본문 attributes.
 *
 * 상한 4096은 JWT 하나가 현실적으로 넘지 않는 크기다. 서명 검증에 들어가기 전에
 * 크기를 자르는 편이 싸다.
 */
export class RefreshTokenInput {
  @IsString()
  @Length(1, 4096)
  refreshToken!: string;
}
