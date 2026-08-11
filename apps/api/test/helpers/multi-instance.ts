import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { validateEnv } from '../../src/config/env.validation';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';
import { RealtimeGateway } from '../../src/modules/realtime/realtime.gateway';
import type { AppServer } from '../../src/modules/realtime/realtime.types';
import { readSharedConnectionStrings } from './shared-connection';
import { buildTestEnv, resetDatabase, TEST_SESSION_COOKIE_NAME } from './test-app';

/**
 * Двух-инстансное окружение под e2e Redis-адаптера socket.io (SLT-34).
 *
 * Смысл именно в двух инстансах: на ОДНОМ адаптер неотличим от своего отсутствия — broadcast и так
 * доходит до всех локальных сокетов. Ценность появляется, только когда инстансов несколько и их
 * связывает Redis pub/sub. Поэтому здесь поднимаются ДВА полноценных Nest-приложения (каждое со
 * своим DI-контейнером, а значит своими RedisService и RedisPubSubProvider — двумя независимыми
 * наборами соединений, ровно как за балансировщиком) поверх ОБЩИХ Postgres и Redis: общий Redis —
 * это и канал адаптера, и общий session-store (кука, выписанная одним инстансом, валидна на другом),
 * общий Postgres — общие доски (доступ к доске одинаков на обоих).
 *
 * В отличие от startTestApp, приложения именно СЛУШАЮТ порт (listen(0), случайный свободный): к ним
 * подключается настоящий socket.io-client по сети, а не supertest поверх in-memory сервера.
 * Контейнеры здесь не поднимаются вовсе (SLT-48) — используются общие, поднятые globalSetup на
 * весь e2e-прогон; connection-строки читаются той же readSharedConnectionStrings, что и в
 * startTestApp — один источник, чтобы окружение e2e не разъехалось между хелперами.
 */

/** Готовое к тесту двух-инстансное окружение. */
export interface TwoInstanceApps {
  /** URL первого инстанса — к нему подключается первый клиент, с него же идёт broadcast. */
  readonly url1: string;
  /** URL второго инстанса — к нему подключается второй клиент, он проверяет приём broadcast. */
  readonly url2: string;
  /**
   * io-сервер первого инстанса. Через него тест инициирует broadcast в комнату доски — это то,
   * что в проде будут делать presence/sync (3.2/3.3). Взят из gateway (@WebSocketServer), а не
   * сконструирован в тесте: адаптер уже привязан именно к этому серверу.
   */
  readonly server1: AppServer;
  /**
   * Завести пользователя и его доску через HTTP первого инстанса, вернув session-куку и boardId.
   * Кука годится для обоих инстансов (общий session-store), доска доступна на обоих (общий Postgres).
   * Только через HTTP: сокету нужна ровно та кука, что выписывает настоящий вход.
   */
  createMemberAndBoard(): Promise<{ cookie: string; boardId: string }>;
  /**
   * Сброс состояния между тестами — тот же resetDatabase, что у test-app (SLT-48): общий хук
   * изоляции для всех e2e, а не свой truncate/flushdb здесь.
   */
  reset(): Promise<void>;
  /** Закрыть оба приложения. Контейнеры общие на весь прогон — их гасит globalTeardown. */
  stop(): Promise<void>;
}

/** Тело регистрации: единственный пользователь этого сценария, детали значения не имеют. */
const MEMBER = {
  email: 'realtime@example.test',
  displayName: 'Realtime',
  password: 'correct horse battery staple',
};

/** Один инстанс: собрать приложение с той же обвязкой, что и прод, и занять случайный порт. */
async function startInstance(config: ReturnType<typeof validateEnv>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();

  const app = moduleRef.createNestApplication();

  // Та же обвязка, что в main.ts (префикс, сессии, ws-адаптер с Redis pub/sub) — тест поднимает
  // тот же транспорт, что уходит в прод.
  configureApp(app);

  // Порт 0 — случайный свободный: два инстанса и локальный docker-compose не дерутся за номер.
  await app.listen(0);

  return app;
}

/** Настоящий сетевой URL инстанса из адреса привязки. getUrl() отдал бы IPv6-форму `[::1]`,
 * с которой socket.io-client спотыкается — берём порт напрямую и бьём в 127.0.0.1. */
function instanceUrl(app: INestApplication): string {
  const { port } = app.getHttpServer().address() as AddressInfo;

  return `http://127.0.0.1:${port}`;
}

/** Из заголовка Set-Cookie достать `name=value` session-куки (без атрибутов Path/HttpOnly/…),
 * пригодный как заголовок Cookie для handshake сокета. */
function extractSessionCookie(setCookie: string[] | undefined): string {
  const raw = setCookie?.find((cookie) => cookie.startsWith(`${TEST_SESSION_COOKIE_NAME}=`));

  if (raw === undefined) {
    throw new Error('Регистрация не вернула session-куку — вход не состоялся');
  }

  // До первой `;` — сама пара name=value; дальше идут атрибуты куки, серверу в запросе не нужные.
  return raw.split(';')[0] ?? raw;
}

export async function startTwoInstanceApps(): Promise<TwoInstanceApps> {
  const { databaseUrl, redisUrl } = readSharedConnectionStrings();

  const config = validateEnv(buildTestEnv(databaseUrl, redisUrl));

  // Инстансы стартуют последовательно: миграции уже накатаны (globalSetup), но оба слушают
  // порт и дёргают Redis — на слабой машине параллельный listen двух приложений ничего не
  // ускоряет, а логи путает.
  const app1 = await startInstance(config);
  const app2 = await startInstance(config);

  const server1 = app1.get(RealtimeGateway).server;
  const prisma = app1.get(PrismaService);
  const redisClient = app1.get(RedisService).client;

  return {
    url1: instanceUrl(app1),
    url2: instanceUrl(app2),
    server1,

    createMemberAndBoard: async () => {
      const agent = request.agent(app1.getHttpServer());

      const registered = await agent.post('/api/auth/register').send(MEMBER);
      if (registered.status !== 201) {
        throw new Error(`Регистрация не удалась (${registered.status})`);
      }
      const cookie = extractSessionCookie(registered.headers['set-cookie'] as string[] | undefined);

      const board = await agent.post('/api/boards').send({ title: 'Realtime board' });
      if (board.status !== 201) {
        throw new Error(`Доска не создана (${board.status})`);
      }

      return { cookie, boardId: (board.body as { id: string }).id };
    },

    // app1 и app2 — два DI-контейнера поверх ОДНОГО Postgres/Redis: truncate/flushdb через
    // клиенты app1 виден обоим инстансам, второй набор клиентов заводить незачем.
    reset: () => resetDatabase(prisma, redisClient),

    stop: async () => {
      // Приложения закрываем: их onModuleDestroy закрывает Prisma, ioredis и pub/sub-соединения.
      // Контейнеры не гасим — они общие на весь прогон, их закрывает globalTeardown.
      await Promise.all([app1.close(), app2.close()]);
    },
  };
}
