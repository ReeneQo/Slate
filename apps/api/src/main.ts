import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { validateEnv } from './config/env.validation';
import { loadEnv } from './config/load-env';

async function bootstrap(): Promise<void> {
  // Подтянуть .env в process.env (в проде реальное окружение имеет приоритет), затем
  // валидировать ДО create(): при битом конфиге — чистая ошибка и process.exit(1), без
  // Nest-стектрейса поверх. Дальше по коду работаем с типизированным config, не process.env.
  loadEnv();
  const config = validateEnv();

  const app = await NestFactory.create(AppModule.forRoot(config));

  // Все маршруты под /api — фронт и будущий reverse-proxy рассчитывают на /api/*.
  app.setGlobalPrefix('api');

  // CORS для SPA (Vite). Origin — из конфига, credentials — под куки-сессии из блока 2.
  app.enableCors({
    origin: config.app.allowedOrigin,
    credentials: true,
  });

  // Единая валидация входа. whitelist — срезает поля вне DTO, transform — приводит к типам DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Корректное закрытие коннектов Prisma/Redis (onModuleDestroy) на SIGTERM/SIGINT.
  app.enableShutdownHooks();

  await app.listen(config.app.port);

  Logger.log(`API is running on ${await app.getUrl()}`, 'Bootstrap');
}

void bootstrap();
