import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { validateEnv } from '../../src/config/env.validation';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';

/**
 * Образы те же, что в docker-compose.yml. Расхождение здесь — худший вид зелёных тестов:
 * они проверяли бы поведение СУБД, которой нет ни у кого ни в деве, ни в проде. Версии
 * зафиксированы точно (не `latest`) по той же причине — прогон не должен менять смысл
 * оттого, что в реестре обновился тег.
 */
const POSTGRES_IMAGE = 'postgres:16';
const REDIS_IMAGE = 'redis:7';

/** Корень пакета с Prisma-схемой: миграции запускаются оттуда, схема адресуется относительно него. */
const DATABASE_PACKAGE_DIR = resolve(__dirname, '../../../../packages/database');

/**
 * Одна таблица, а не список: остальные (boards, elements, board_members) ссылаются на users
 * внешними ключами, и CASCADE уносит их сам. Перечислять их вручную — значит завести список,
 * который придётся не забыть дополнить в блоке 3.
 */
const TRUNCATE_ALL_SQL = 'TRUNCATE TABLE "users" RESTART IDENTITY CASCADE';

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
function buildTestEnv(databaseUrl: string, redisUrl: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    NODE_ENV: 'test',
    ALLOWED_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: 'e2e-only-session-secret-not-a-real-one',
    SESSION_NAME: TEST_SESSION_COOKIE_NAME,
    SESSION_MAX_AGE: '604800000',
  };
}

/**
 * Накатывает миграции на свежий контейнер.
 *
 * Шаг обязательный и именно в этом месте: контейнерный Postgres пуст, таблиц в нём нет,
 * и без миграций первый же register упал бы пятисоткой «relation users does not exist» —
 * ошибкой, которая выглядит как баг приложения, а не как незаконченная подготовка.
 *
 * `migrate deploy`, а не `migrate dev`: deploy только применяет уже существующие файлы
 * миграций и ничего не генерирует. dev в этой роли стал бы сравнивать схему с базой, а при
 * расхождении — предлагать сброс, то есть интерактивный вопрос посреди прогона.
 *
 * DATABASE_URL передаётся ТОЛЬКО этому процессу, через env дочернего вызова. Писать его в
 * process.env текущего процесса нельзя: prisma.config.ts читает переменную «мягко», и такая
 * запись протекла бы в остальной прогон.
 */
function applyMigrations(databaseUrl: string): void {
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: DATABASE_PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    // Без этого наружу выходит голое «Command failed» с кодом возврата: stdio: 'pipe'
    // проглатывает stderr Prisma, где как раз и написана настоящая причина.
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';

    throw new Error(`prisma migrate deploy не отработал:\n${stderr}`);
  }
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
  /** Закрыть приложение и погасить контейнеры. */
  stop(): Promise<void>;
}

/**
 * Поднимает полное окружение: контейнеры → миграции → приложение.
 *
 * Порядок здесь причинно-следственный, а не стилистический. Контейнеры первыми, потому что
 * до старта неизвестны их URL: порты назначаются случайные (иначе параллельные прогоны и
 * локальный docker-compose дрались бы за 5432). Миграции вторыми — приложение при старте
 * коннектится к базе, и схема к этому моменту уже должна быть накатана. Приложение
 * последним, получая оба URL значением.
 *
 * Контейнеры стартуют параллельно: они друг от друга не зависят, а на холодном старте это
 * разница между «двумя ожиданиями подряд» и «одним».
 */
export async function startTestApp(): Promise<TestApp> {
  const [postgres, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);

  applyMigrations(postgres.getConnectionUri());

  const config = validateEnv(buildTestEnv(postgres.getConnectionUri(), redis.getConnectionUrl()));

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

  // Хранилище счётчиков throttler'а. Достаётся по символьному токену — тому же, под которым
  // его регистрирует сам пакет.
  const throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);

  // getHttpServer типизирован как any (Nest не знает, какой адаптер под ним). Сужаем один
  // раз здесь, чтобы any не расползся по тестам.
  const httpServer = app.getHttpServer() as Server;

  return {
    prisma,

    createAgent: () => request.agent(httpServer),

    /**
     * Между тестами чистится ТРИ хранилища, и пропуск любого даёт свой характерный провал.
     *
     * 1. Таблицы — иначе повторный прогон падает на «email занят» в тесте регистрации:
     *    пользователь остался от прошлого раза. Именно это делает прогон неповторяемым.
     * 2. Redis — иначе сессии предыдущих тестов продолжают жить, и тест «без куки → 401»
     *    рискует пройти по чужой валидной сессии.
     * 3. Счётчики throttler'а — самое неочевидное. Лимиты боевые (register 3/час,
     *    login 5/15 мин), приложение поднято ОДНО на весь файл, а IP у supertest всегда
     *    один. Без сброса четвёртый по счёту register в файле получил бы 429 — и упал бы
     *    не тот тест, который что-то сломал, а тот, которому не повезло идти четвёртым.
     *
     * Сбрасывается именно хранилище, а не подменяется guard: подменённый guard означал бы,
     * что throttling в e2e не проверяется вообще и его поломку никто не заметит.
     */
    reset: async () => {
      await prisma.$executeRawUnsafe(TRUNCATE_ALL_SQL);
      await redisClient.flushdb();
      throttlerStorage.storage.clear();
    },

    /**
     * Порядок обратный запуску: сначала приложение (его onModuleDestroy закрывает пул
     * Prisma и коннект ioredis), потом контейнеры. Погасив контейнеры первыми, мы бы
     * оставили клиентов закрываться в мёртвую сеть — это висящие таймауты на выходе.
     */
    stop: async () => {
      await app.close();
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}
