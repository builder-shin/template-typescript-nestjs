import { Module } from '@nestjs/common';
import { ExamplesController } from '../app/controllers/api/v1/examples.controller.js';
import { HealthController } from '../app/controllers/health.controller.js';

/**
 * 공개 라우트의 유일한 등록 지점.
 *
 * 컨트롤러 자동 탐색을 추가하지 않는다. 아래 배열에 없는 컨트롤러는 존재하지 않는 것과 같다.
 */
@Module({
  controllers: [HealthController, ExamplesController],
})
export class RoutesModule {}
