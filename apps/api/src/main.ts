import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Все маршруты под /api — фронт и будущий reverse-proxy рассчитывают на /api/*.
  // Менять префикс позже больно, поэтому фиксируем сразу.
  app.setGlobalPrefix('api');

  // CORS для SPA (Vite). Origin — из env, credentials — под куки-сессии из блока 2.
  app.enableCors({
    origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  // Единая валидация входа. whitelist — срезает поля вне DTO,
  // transform — приводит payload к типам DTO. DTO появятся в блоке 2, конфиг стабилен.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Корректное закрытие коннектов (Prisma/Redis из SLT-12) на SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // API_PORT (не PORT) — чтобы не коллидировать с портом Vite.
  // TODO(SLT-12): заменить на валидированный zod-config.
  const port = process.env.API_PORT ?? 3000;
  await app.listen(port);

  Logger.log(`API is running on ${await app.getUrl()}`, 'Bootstrap');
}

void bootstrap();
