import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { validateEnv } from '../../src/config/env.validation';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';
import { readSharedConnectionStrings } from './shared-connection';

/**
 * Имя session-куки в тестах. Совпадает с дев-значением SESSION_NAME, но задано здесь явно:
 * тесты проверяют наличие и снятие именно этой куки, и брать её имя из чужого .env значило бы
 * ронять прогон у того, кто поменял переменную у себя.
 */
export const TEST_SESSION_COOKIE_NAME = 'slate.sid';

/**
 * Окружение приложения под тестом — ЦЕЛИКОМ здесь, а не в process.env.
 *
 * `validateEnv` принимает источник аргументом, и это снимает главную грабку e2e: обычно
 * динамические URL контейнеров приходится писать в process.env ДО создания приложения и
 * следить, чтобы порядок импортов этого не переиграл. Здесь порядка не существует — конфиг
 * просто передаётся значением. Заодно прогон перестаёт зависеть от .env разработчика:
 * локальные SESSION_MAX_AGE или ALLOWED_ORIGIN на тесты не влияют вообще никак.
 *
 * NODE_ENV=test важен содержательно: из него выводится `secure` у куки. В production-режиме
 * кука ушла бы с флагом Secure, клиент по http её бы не вернул — вход «работал» бы, а
 * последующий /me отдавал 401 без единой подсказки, почему.
 *
 * API_PORT не задан намеренно: приложение поднимается через `app.init()` и порт не слушает,
 * а схема подставит дефолт. Секрет — фиксированная строка нужной длины: он подписывает
 * session-id внутри одного прогона и ничего не защищает.
 */
export function buildTestEnv(databaseUrl: string, redisUrl: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    NODE_ENV: 'test',
    ALLOWED_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: 'e2e-only-session-secret-not-a-real-one',
    SESSION_NAME: TEST_SESSION_COOKIE_NAME,
    SESSION_MAX_AGE: '7d',
  };
}

/** Агент supertest с собственной банкой кук — тип берём у самой библиотеки, чтобы не угадывать. */
export type TestAgent = ReturnType<typeof request.agent>;

export interface TestApp {
  /** Прямой доступ к БД — для проверок «а лежит ли это в базе на самом деле». */
  readonly prisma: PrismaService;
  /**
   * Новый клиент с ПУСТОЙ банкой кук. Свежий агент на каждый сценарий — это и анонимный
   * клиент для проверок 401, и гарантия, что кука из предыдущего теста не подтечёт в следующий.
   */
  createAgent(): TestAgent;
  /** Сброс состояния между тестами. */
  reset(): Promise<void>;
  /** Закрыть приложение. Контейнеры общие на весь прогон — их гасит globalTeardown. */
  stop(): Promise<void>;
}

/**
 * Список таблиц берётся динамически из information_schema, а не хардкодится. До SLT-48 здесь
 * лежала одна строка `TRUNCATE TABLE "users" ... CASCADE`, и она работала только потому, что
 * все остальные таблицы ссылались на users внешним ключом. Новая таблица без такой ссылки
 * протекала бы между тестами молча: CASCADE её бы не подхватил, а узнать об этом можно было бы
 * только по нестабильным падениям от чужих данных, а не по явной ошибке.
 *
 * `_prisma_migrations` исключена: это служебная таблица самого Prisma, трогать её не нужно и
 * не должно — миграции накатаны один раз в globalSetup.
 */
async function truncateAllTables(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    return;
  }

  const targets = tables.map(({ table_name }) => `"${table_name}"`).join(', ');

  // RESTART IDENTITY — на будущее: все id в схеме сейчас uuid v7 (нет serial/autoincrement),
  // так что сбрасывать нечего, но это дёшево и защищает от неявной регрессии, если появится
  // таблица со своей последовательностью.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`);
}

/**
 * Общий хук изоляции для ВСЕХ e2e (SLT-48). И test-app (обычные спеки), и multi-instance
 * (realtime-redis-adapter) зовут ИМЕННО эту функцию в своём reset(), а не пишут свой
 * truncate/flushdb — иначе список таблиц или порядок операций рано или поздно разошлись бы
 * между обычными спеками и адаптером.
 *
 * Порядок: сначала Postgres, потом Redis. Не то чтобы порядок был причинно важен (таблицы и
 * Redis-ключи друг от друга не зависят), но так тест, упавший на самом truncate, не оставляет
 * относительно него грязный Redis — проще диагностировать по логу, что именно не сброшено.
 *
 * Чистятся ДВА хранилища, и пропуск любого даёт свой характерный провал:
 * 1. Таблицы — иначе повторный прогон падает на «email занят» в тесте регистрации:
 *    пользователь остался от прошлого раза (или от предыдущего e2e-файла — контейнер общий).
 * 2. Redis (flushdb) — снимает разом ДВЕ вещи из одной базы:
 *    - сессии: иначе тест «без куки → 401» рискует пройти по чужой валидной сессии;
 *    - счётчики throttler'а: лимиты боевые (register 3/час, login 5/15 мин), приложение
 *      поднято ОДНО на весь файл, IP у supertest всегда один — без сброса четвёртый по счёту
 *      register получил бы 429 не в том тесте, что его исчерпал. Счётчики живут в том же
 *      Redis (SLT-29, storage → Redis), поэтому flushdb чистит и их.
 */
export async function resetDatabase(prisma: PrismaService, redis: Redis): Promise<void> {
  await truncateAllTables(prisma);
  await redis.flushdb();
}

/**
 * Поднимает приложение поверх ОБЩИХ контейнеров e2e-прогона (SLT-48): их адреса публикует
 * globalSetup через process.env (см. shared-connection.ts), здесь только чтение готовых строк —
 * ни поднятия контейнеров, ни миграций (то и другое уже сделано один раз, до старта всех файлов).
 */
export async function startTestApp(): Promise<TestApp> {
  const { databaseUrl, redisUrl } = readSharedConnectionStrings();

  const config = validateEnv(buildTestEnv(databaseUrl, redisUrl));

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();

  // Та же обвязка, что в main.ts. Без неё не было бы ни сессий (а значит и всего auth),
  // ни префикса /api, ни валидации DTO — тесты проверяли бы другое приложение.
  configureApp(app);

  await app.init();

  const prisma = app.get(PrismaService);
  const redisClient = app.get(RedisService).client;

  // getHttpServer типизирован как any (Nest не знает, какой адаптер под ним). Сужаем один
  // раз здесь, чтобы any не расползся по тестам.
  const httpServer = app.getHttpServer() as Server;

  return {
    prisma,

    createAgent: () => request.agent(httpServer),

    reset: () => resetDatabase(prisma, redisClient),

    // Контейнеры не гасим: они общие на весь прогон, их закрывает globalTeardown уже после
    // того, как отработают afterAll всех файлов.
    stop: async () => {
      await app.close();
    },
  };
}
