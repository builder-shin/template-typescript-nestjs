import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JsonApiExceptionFilter } from '../app/jsonapi/exception-filter.js';
import { JsonApiResponseInterceptor } from '../app/jsonapi/response.js';
import { RouteMethods } from '../app/jsonapi/route-methods.js';
import { buildDataSourceOptions } from './database.js';
import { RoutesModule } from './routes.module.js';
import { loadDatabaseSettings } from './settings.js';

/**
 * 애플리케이션 루트 모듈. 전역 미들웨어와 필터는 여기에서 등록 순서까지 검토한다.
 *
 * 예외 필터는 전역이고 응답 인터셉터는 라우트별로 꺼진다. 근거는 두 파일의 주석에 있다.
 *
 * `DATABASE_URL`은 모듈 조립 시점에 읽는다. 없으면 프로세스가 시작되지 않는다 —
 * 첫 요청에서야 드러나는 설정 오류보다 시작 실패가 낫다.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDataSourceOptions(loadDatabaseSettings()),
    }),
    RoutesModule,
  ],
  providers: [
    RouteMethods,
    { provide: APP_FILTER, useClass: JsonApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: JsonApiResponseInterceptor },
  ],
})
export class AppModule {}
