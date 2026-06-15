import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Все маршруты под /api — отделяет API от возможной статики/доков.
  app.setGlobalPrefix('api');

  // Единый формат ошибок на весь сервис.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Корректное закрытие соединений (Prisma, Redis) при SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(`API is running on ${await app.getUrl()}`, 'Bootstrap');
}

void bootstrap();
