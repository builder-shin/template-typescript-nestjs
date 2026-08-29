import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { setupOpenApi } from './openapi.js';
import { loadServerSettings } from './settings.js';

async function bootstrap(): Promise<void> {
  const settings = loadServerSettings();
  const app = await NestFactory.create(AppModule);
  setupOpenApi(app);
  await app.listen(settings.port, '0.0.0.0');
}

await bootstrap();
