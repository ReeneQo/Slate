import { AUTOSAVE_LIMIT, DEFAULT_LIMIT } from '../src/infrastructure/throttler/throttle.limits';
import { createBoard, elementBody, elementId, elementUrl, signUp, USER_A } from './helpers/api';
import { startTestApp, type TestApp } from './helpers/test-app';

const BOARDS_URL = '/api/boards';
const HEALTH_URL = '/api/health';

/**
 * Сквозные тесты глобального троттлинга (SLT-30): настоящий HTTP, настоящий Redis-storage.
 *
 * Юнит здесь бесполезен: троттлинг — это поведение НА СТЫКЕ guard'а, хранилища счётчиков и
 * маршрутизации, а именно стык юнитом и не покрывается. Проверяем ровно то, что ломается на
 * практике: срабатывает ли baseline-лимит, обходят ли его исключения (/health, autosave-путь).
 *
 * Лимиты импортируются из боевого кода, а не хардкодятся: тест сверяет поведение на РЕАЛЬНОЙ
 * границе. Поменяется число в throttle.limits — тест поедет за ним, а не начнёт молча врать.
 *
 * Запросы всегда ПОСЛЕДОВАТЕЛЬНО, не через Promise.all: supertest поднимает эфемерный listen
 * на каждый запрос к неслушающему серверу, и параллельные вызовы изредка дерутся за него с
 * ECONNRESET — флаки в тесте про лимиты никому не нужны.
 */
describe('Throttle (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    await testApp?.stop();
  });

  beforeEach(async () => {
    // reset() делает flushdb — а счётчики троттлера живут в том же Redis (SLT-29). Без сброса
    // лимит утёк бы из теста в тест, и падал бы не тот, что пробил потолок, а следующий за ним.
    await testApp.reset();
  });

  describe('baseline (default)', () => {
    it('глушит 429-м, когда клиент пробивает baseline на обычном роуте', async () => {
      const anonymous = testApp.createAgent();

      // Роут под @Authorization() — без куки это 401. Но throttler-guard глобальный (APP_GUARD)
      // и считает запрос ДО auth-guard, поэтому счётчик растёт даже на анонимных обращениях.
      // Первые `limit` запросов проходят throttle (и упираются в 401), а (limit + 1)-й guard
      // рубит 429-м раньше, чем дело дойдёт до авторизации.
      for (let i = 0; i < DEFAULT_LIMIT.limit; i++) {
        const response = await anonymous.get(BOARDS_URL);

        expect(response.status).toBe(401);
      }

      const blocked = await anonymous.get(BOARDS_URL);

      expect(blocked.status).toBe(429);
    });
  });

  describe('/health (SkipThrottle)', () => {
    it('не душится под нагрузкой выше baseline', async () => {
      const anonymous = testApp.createAgent();

      // Шлём заведомо больше baseline: попадай /health под default — (limit + 1)-й дал бы 429.
      // Все до единого 200 доказывают, что @SkipThrottle() реально снял пробу с лимита.
      const total = DEFAULT_LIMIT.limit + 20;

      for (let i = 0; i < total; i++) {
        const response = await anonymous.get(HEALTH_URL);

        expect(response.status).toBe(200);
      }
    });
  });

  describe('autosave-путь (element)', () => {
    it('переживает поток мутаций, который пробил бы baseline', async () => {
      const { agent } = await signUp(testApp, USER_A);
      const board = await createBoard(agent);
      const url = elementUrl(elementId(1));
      const body = elementBody(board.id);

      // Больше baseline, но меньше autosave-лимита. Не будь `default` снят с element-контроллера,
      // (baseline + 1)-й PUT вернул бы 429. Ни одного 429 → default снят, а щедрый autosave
      // покрывает поток — ровно то, ради чего autosave-путь вынесен в отдельный лимит.
      const burst = DEFAULT_LIMIT.limit + 10;

      expect(burst).toBeLessThan(AUTOSAVE_LIMIT.limit);

      for (let i = 0; i < burst; i++) {
        const response = await agent.put(url).send(body);

        // Статус upsert (201/200) проверяется в element.e2e — здесь важно ровно одно: не 429.
        expect(response.status).not.toBe(429);
      }
    });
  });
});
