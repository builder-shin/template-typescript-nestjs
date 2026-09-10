import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './http.js';
import { setupOpenApi } from './openapi.js';
import { loadServerSettings } from './settings.js';

async function bootstrap(): Promise<void> {
  const settings = loadServerSettings();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttp(app);
  setupOpenApi(app);
  await app.listen(settings.port, '0.0.0.0');
}

await bootstrap();
