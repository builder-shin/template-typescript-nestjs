import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI 문서를 등록한다.
 *
 * `@nestjs/swagger`의 CLI 플러그인은 webpack 빌드를 전제하므로 쓰지 않는다.
 * 스키마는 `@ApiProperty` 등 명시 데코레이터로만 표현한다.
 * `app.init()` 전에 호출해야 한다.
 *
 * `addBearerAuth()`를 등록한다. Phase 6이 만든 첫 인증 라우트(Example 쓰기,
 * `GET /api/v1/users/me`)부터 Bearer access token을 요구하므로, 이 스킴을 등록해야
 * 그 라우트에 붙는 `@ApiBearerAuth()`가 가리킬 보안 스킴이 실제로 존재한다. 이름을
 * 넘기지 않아 기본값 `'bearer'`를 쓰고, `@ApiBearerAuth()` 쪽도 기본값을 그대로 쓰므로
 * 두 쪽의 스킴 이름이 어긋날 일이 없다. Phase 0~5에는 인증된 라우트가 없어 등록하지
 * 않았었다 — 그때 넣었다면 발행되는 문서가 어떤 operation에도 걸리지 않는 인증
 * 메커니즘을 광고해 이 스키마로 클라이언트를 생성하는 쪽을 오도했을 것이다.
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
