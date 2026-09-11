import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { enrichOpenApi } from './openapi-contract.js';

/**
 * OpenAPI 3.1 is generated from explicitly registered routes and enriched with the
 * same DTO validation metadata, ORM columns, serializers and QueryPolicy used at runtime.
 * No route discovery or runtime route registration occurs in the documentation builder.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('NestJS Template')
    .setDescription('NestJS JSON:API 1.1 템플릿')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  enrichOpenApi(document, app.get(DataSource));

  SwaggerModule.setup('api-docs', app, document, {
    jsonDocumentUrl: 'api/schema',
  });
}
