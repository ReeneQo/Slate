import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { validateEnv } from './config/env.validation';
import { loadEnv } from './config/load-env';

async function bootstrap(): Promise<void> {
  // Подтянуть .env в process.env (в проде реальное окружение имеет приоритет), затем
  // валидировать ДО create(): при битом конфиге — чистая ошибка и process.exit(1), без
  // Nest-стектрейса поверх. Дальше по коду работаем с типизированным config, не process.env.
  loadEnv();
  const config = validateEnv();

  const app = await NestFactory.create(AppModule.forRoot(config));

  // Префикс, helmet, сессии, CORS и валидация — одним вызовом, ОБЩИМ с e2e-тестами:
  // так тесты поднимают то же приложение, что уходит в прод, а не его копию, которая
  // разъедется при первой правке. Порядок middleware важен и зафиксирован внутри.
  configureApp(app);

  // Корректное закрытие коннектов Prisma/Redis (onModuleDestroy) на SIGTERM/SIGINT.
  app.enableShutdownHooks();

  await app.listen(config.app.port);

  Logger.log(`API is running on ${await app.getUrl()}`, 'Bootstrap');
}

void bootstrap();
