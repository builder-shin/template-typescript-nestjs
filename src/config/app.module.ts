import { Module } from '@nestjs/common';
import { RoutesModule } from './routes.module.js';

/** 애플리케이션 루트 모듈. 전역 미들웨어와 필터는 여기에서 등록 순서까지 검토한다. */
@Module({
  imports: [RoutesModule],
})
export class AppModule {}
