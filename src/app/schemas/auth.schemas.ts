import { Transform } from 'class-transformer';
import { IsString, Length, MinLength, ValidateBy } from 'class-validator';
import { canonicalEmail } from '../auth/email-identity.js';
function normalize({ value }: { value: unknown }): unknown {
  return canonicalEmail(value);
}
export class UserRegister {
  @Transform(normalize)
  @ValidateBy({
    name: 'email',
    validator: { validate: (value: unknown) => typeof value === 'string' },
  })
  @Length(3, 254)
  email!: string;
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class AuthCredentials extends UserRegister {}
export class RefreshTokenInput {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
