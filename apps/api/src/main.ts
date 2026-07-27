import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { validateEnv } from './config/env.validation';
import { loadEnv } from './config/load-env';
import { RedisService } from './infrastructure/redis/redis.service';
import { createSessionMiddleware } from './infrastructure/session/session.factory';

async function bootstrap(): Promise<void> {
  // Подтянуть .env в process.env (в проде реальное окружение имеет приоритет), затем
  // валидировать ДО create(): при битом конфиге — чистая ошибка и process.exit(1), без
  // Nest-стектрейса поверх. Дальше по коду работаем с типизированным config, не process.env.
  loadEnv();
  const config = validateEnv();

  const app = await NestFactory.create(AppModule.forRoot(config));

  // Все маршруты под /api — фронт и будущий reverse-proxy рассчитывают на /api/*.
  app.setGlobalPrefix('api');

  // ── Порядок middleware важен, поэтому он здесь явный и подряд ──────────────
  //
  // 1. helmet первым: заголовки безопасности должны стоять на ЛЮБОМ ответе, включая
  //    ошибки и 404, которые следующие слои могут вернуть раньше, чем дойдёт очередь.
  // 2. session вторым: к моменту работы роутов req.session уже разобран.
  // 3. cors последним из троицы, но до роутов.
  //
  // cookie-parser намеренно НЕ ставим: express-session сам читает и пишет свою куку,
  // а его документация прямо предупреждает о проблемах при расхождении секретов между
  // ним и cookie-parser. res.clearCookie — встроенный метод Express и парсер не требует.
  app.use(helmet());

  // Session-store поднят на ОБЩЕМ ioredis-клиенте: достаём его из DI, а не создаём
  // второй коннект. ConfigService берём оттуда же, чтобы конфиг был один и тот же
  // объект, а не заново провалидированная копия.
  const configService = app.get(ConfigService);
  const redisClient = app.get(RedisService).client;

  app.use(createSessionMiddleware(configService, redisClient));

  // CORS для SPA (Vite). Origin — из конфига, credentials — обязателен: без него
  // браузер не отправит session-куку на кросс-origin запрос (5173 → 3000).
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
