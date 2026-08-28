import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI 문서를 등록한다.
 *
 * `@nestjs/swagger`의 CLI 플러그인은 webpack 빌드를 전제하므로 쓰지 않는다.
 * 스키마는 `@ApiProperty` 등 명시 데코레이터로만 표현한다.
 * `app.init()` 전에 호출해야 한다.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('NestJS Template')
    .setDescription('NestJS JSON:API 1.1 템플릿')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document, {
    jsonDocumentUrl: 'api/schema',
  });
}
