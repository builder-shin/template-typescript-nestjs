import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI 문서를 등록한다.
 *
 * `@nestjs/swagger`의 CLI 플러그인은 webpack 빌드를 전제하므로 쓰지 않는다.
 * 스키마는 `@ApiProperty` 등 명시 데코레이터로만 표현한다.
 * `app.init()` 전에 호출해야 한다.
 *
 * `addBearerAuth()`를 넣지 않는다. Phase 0에는 인증된 라우트가 없어서, 지금 넣으면
 * 발행되는 문서가 어떤 operation에도 걸리지 않는 인증 메커니즘을 광고하게 되고
 * 이 스키마로 클라이언트를 생성하는 쪽을 오도한다. Phase 6에서 첫 `@ApiBearerAuth()`
 * 라우트를 만들 때 그 변경과 함께 추가한다.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('NestJS Template')
    .setDescription('NestJS JSON:API 1.1 템플릿')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document, {
    jsonDocumentUrl: 'api/schema',
  });
}
