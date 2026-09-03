import { Module } from '@nestjs/common';
import { AuthController } from '../app/controllers/api/v1/auth.controller.js';
import { ExamplesController } from '../app/controllers/api/v1/examples.controller.js';
import { UsersController } from '../app/controllers/api/v1/users.controller.js';
import { HealthController } from '../app/controllers/health.controller.js';
import { JwtActiveUserGuard } from '../app/auth/current-user.guard.js';
import { JWT_SETTINGS_TOKEN, TokenService } from '../app/auth/tokens.js';
import { loadJwtSettings } from './settings.js';

/**
 * 공개 라우트의 유일한 등록 지점.
 *
 * 컨트롤러 자동 탐색을 추가하지 않는다. 아래 배열에 없는 컨트롤러는 존재하지 않는 것과 같다.
 *
 * 인증 프로바이더가 여기 있는 이유: 이 템플릿은 모듈을 늘리지 않는다(`AppModule`과
 * 이 모듈 둘뿐). 가드와 token 서비스는 라우트가 쓰는 것이므로 라우트 등록 지점이
 * 소유한다.
 *
 * `JWT_SETTINGS_TOKEN`을 조립 시점에 읽는다. `DATABASE_URL`과 같은 계약이다 —
 * 첫 요청에서야 드러나는 설정 오류보다 시작 실패가 낫다.
 */
@Module({
  controllers: [HealthController, ExamplesController, AuthController, UsersController],
  providers: [
    { provide: JWT_SETTINGS_TOKEN, useFactory: () => loadJwtSettings() },
    TokenService,
    JwtActiveUserGuard,
  ],
})
export class RoutesModule {}
