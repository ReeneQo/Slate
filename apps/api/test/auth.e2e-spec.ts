import type { Response } from 'supertest';

import {
  startTestApp,
  TEST_SESSION_COOKIE_NAME,
  type TestAgent,
  type TestApp,
} from './helpers/test-app';

const REGISTER_URL = '/api/auth/register';
const LOGIN_URL = '/api/auth/login';
const LOGOUT_URL = '/api/auth/logout';
const LOGOUT_ALL_URL = '/api/auth/logout-all';
const ME_URL = '/api/auth/me';

const USER = {
  email: 'renee@example.test',
  displayName: 'Renee',
  password: 'correct horse battery',
};

/** Set-Cookie всегда массив (заголовок может повторяться), пустой список удобнее undefined. */
function setCookies(response: Response): string[] {
  const header: unknown = response.headers['set-cookie'];

  return Array.isArray(header) ? (header as string[]) : [];
}

function sessionCookie(response: Response): string | undefined {
  return setCookies(response).find((cookie) => cookie.startsWith(`${TEST_SESSION_COOKIE_NAME}=`));
}

/**
 * Сквозные тесты auth: настоящий HTTP, настоящий Postgres, настоящий Redis.
 *
 * Здесь НЕ дублируется то, что уже покрыто юнитами AuthService (нормализация email,
 * DUMMY_HASH, ветки отказа). Юнит отвечает на вопрос «правильно ли рассуждает сервис»,
 * а этот файл — на другой: «доходит ли решение сервиса до клиента через весь стек».
 * Между ними лежит ровно то, что юнитом не проверяется и что ломается на практике:
 * порядок middleware, кука, сериализация тела, статус-коды, guard, реальный constraint в БД.
 */
describe('Auth (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    // Проверка на undefined не лишняя: упади startTestApp (нет Docker, не встали
    // миграции) — afterAll всё равно вызовется, и обращение к полю дало бы вторую,
    // маскирующую ошибку поверх настоящей.
    await testApp?.stop();
  });

  beforeEach(async () => {
    await testApp.reset();
  });

  describe(`POST ${REGISTER_URL}`, () => {
    it('создаёт пользователя, ставит session-куку и кладёт запись в базу', async () => {
      const response = await testApp.createAgent().post(REGISTER_URL).send(USER);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String),
        email: USER.email,
        displayName: USER.displayName,
      });

      // Кука — это и есть авто-вход: без неё register вернул бы 201, а пользователь
      // остался бы неаутентифицированным.
      expect(sessionCookie(response)).toBeDefined();

      // Ответ мог бы быть правильным и без записи в базу — проверяем факт, а не отчёт о нём.
      // findFirst, а не findUnique: email больше не @unique в схеме (SLT-44, functional index
      // по lower(email) живёт в SQL-миграции) — UserWhereUniqueInput его не принимает.
      const stored = await testApp.prisma.user.findFirst({ where: { email: USER.email } });

      expect(stored).not.toBeNull();
      expect(stored?.displayName).toBe(USER.displayName);

      // Пароль обязан лежать в виде argon2id-хеша. Проверка именно на префикс алгоритма,
      // а не «не равен паролю»: последнее прошло бы и для base64, и для любой другой
      // обратимой ерунды.
      expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('отвечает 409 на повторную регистрацию с тем же email', async () => {
      await testApp.createAgent().post(REGISTER_URL).send(USER).expect(201);

      // Второй запрос идёт от ДРУГОГО агента: дубликат должен ловиться unique-constraint'ом
      // в базе, а не тем, что клиент помнит свою прошлую сессию.
      const response = await testApp.createAgent().post(REGISTER_URL).send(USER);

      expect(response.status).toBe(409);
    });
  });

  describe(`POST ${LOGIN_URL}`, () => {
    it('пускает по верному паролю и выдаёт session-куку', async () => {
      await testApp.createAgent().post(REGISTER_URL).send(USER).expect(201);

      const response = await testApp
        .createAgent()
        .post(LOGIN_URL)
        .send({ email: USER.email, password: USER.password });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: expect.any(String),
        email: USER.email,
        displayName: USER.displayName,
      });
      expect(sessionCookie(response)).toBeDefined();
    });

    it('отвечает 401 на неверный пароль и не выдаёт куку', async () => {
      await testApp.createAgent().post(REGISTER_URL).send(USER).expect(201);

      const response = await testApp
        .createAgent()
        .post(LOGIN_URL)
        .send({ email: USER.email, password: 'definitely wrong' });

      expect(response.status).toBe(401);
      expect(sessionCookie(response)).toBeUndefined();
    });

    it('отвечает на несуществующий email РОВНО ТЕМ ЖЕ, что и на неверный пароль', async () => {
      await testApp.createAgent().post(REGISTER_URL).send(USER).expect(201);

      const wrongPassword = await testApp
        .createAgent()
        .post(LOGIN_URL)
        .send({ email: USER.email, password: 'definitely wrong' });

      const unknownEmail = await testApp
        .createAgent()
        .post(LOGIN_URL)
        .send({ email: 'ghost@example.test', password: USER.password });

      // Тела сравниваются ЦЕЛИКОМ, а не по полю message. Разойдись они хоть в одном
      // символе — форма логина превращается в бесплатный сервис проверки «а этот email
      // у вас зарегистрирован?», и никакой DUMMY_HASH этого уже не спасёт.
      expect(unknownEmail.status).toBe(wrongPassword.status);
      expect(unknownEmail.body).toEqual(wrongPassword.body);
    });
  });

  describe(`GET ${ME_URL}`, () => {
    it('отдаёт полный контракт пользователя по куке', async () => {
      const agent = testApp.createAgent();
      const registered = await agent.post(REGISTER_URL).send(USER).expect(201);

      // ТОТ ЖЕ агент: он хранит куку, полученную при регистрации, и шлёт её обратно.
      // С голым запросом здесь был бы 401 — и это выглядело бы как сломанный guard.
      const response = await agent.get(ME_URL);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: registered.body.id,
        email: USER.email,
        displayName: USER.displayName,
        hasPassword: true,
        createdAt: expect.any(String),
      });
    });

    it('отвечает 401 без куки', async () => {
      await testApp.createAgent().post(REGISTER_URL).send(USER).expect(201);

      // Новый агент = пустая банка кук. Пользователь в базе есть, сессии у клиента нет.
      const response = await testApp.createAgent().get(ME_URL);

      expect(response.status).toBe(401);
    });
  });

  describe(`POST ${LOGOUT_URL}`, () => {
    it('снимает куку у клиента и делает сессию непригодной', async () => {
      const agent = testApp.createAgent();

      await agent.post(REGISTER_URL).send(USER).expect(201);
      await agent.get(ME_URL).expect(200);

      const response = await agent.post(LOGOUT_URL);

      expect(response.status).toBe(204);

      // Кука гасится ПУСТЫМ значением с датой в прошлом — так браузеру говорят «удали».
      // Просто «сессии больше нет в Redis» недостаточно: клиент остался бы с валидной
      // на вид кукой и выглядел бы залогиненным до истечения TTL.
      const cleared = sessionCookie(response);

      expect(cleared).toBeDefined();
      expect(cleared).toMatch(new RegExp(`^${TEST_SESSION_COOKIE_NAME}=;`));
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970');

      // Главная проверка — не заголовок, а последствие: тем же агентом внутрь уже не войти.
      await agent.get(ME_URL).expect(401);
    });
  });

  describe(`POST ${LOGOUT_ALL_URL}`, () => {
    /**
     * Второй вход тем же пользователем с ЧИСТОГО агента = вторая независимая сессия с
     * собственной кукой. Именно до таких чужих сессий обычным logout не дотянуться — и
     * ровно их обязан обесценивать logout-all.
     */
    async function loginAgain(): Promise<TestAgent> {
      const agent = testApp.createAgent();
      await agent.post(LOGIN_URL).send({ email: USER.email, password: USER.password }).expect(200);

      return agent;
    }

    it('обесценивает ВСЕ сессии пользователя, включая ту, из которой вызван', async () => {
      // Две живые сессии одного пользователя: первая — авто-вход при регистрации, вторая —
      // отдельный login с другого агента.
      const first = testApp.createAgent();
      await first.post(REGISTER_URL).send(USER).expect(201);
      const second = await loginAgain();

      // До вызова обе сессии рабочие — иначе тест доказывал бы не то.
      await first.get(ME_URL).expect(200);
      await second.get(ME_URL).expect(200);

      await first.post(LOGOUT_ALL_URL).expect(204);

      // Ключевой кейс таски: сдвиг поколения из ОДНОЙ сессии роняет ОБЕ на следующем же
      // защищённом запросе — и инициатора (first, «полный» вариант), и постороннюю (second).
      await first.get(ME_URL).expect(401);
      await second.get(ME_URL).expect(401);
    });

    it('не мешает войти заново: новая сессия снимает уже сдвинутое поколение', async () => {
      const agent = testApp.createAgent();
      await agent.post(REGISTER_URL).send(USER).expect(201);

      await agent.post(LOGOUT_ALL_URL).expect(204);
      await agent.get(ME_URL).expect(401);

      // Сдвиг поколения обесценивает ПРОШЛЫЕ сессии, а не блокирует аккаунт: свежий вход
      // снимает актуальное поколение и снова проходит guard.
      const fresh = await loginAgain();
      await fresh.get(ME_URL).expect(200);
    });

    it('требует авторизации: без сессии — 401, поколение не двигается', async () => {
      await testApp.createAgent().post(LOGOUT_ALL_URL).expect(401);
    });
  });

  describe('регресс: обычный logout не трогает чужие сессии того же пользователя', () => {
    it('после logout одной сессии вторая остаётся живой', async () => {
      const first = testApp.createAgent();
      await first.post(REGISTER_URL).send(USER).expect(201);

      const second = testApp.createAgent();
      await second.post(LOGIN_URL).send({ email: USER.email, password: USER.password }).expect(200);

      // logout бьёт РОВНО текущую сессию и НЕ двигает поколение. Если бы двигал — вторая
      // сессия получила бы 401, и разница между logout и logout-all стёрлась бы.
      await second.post(LOGOUT_URL).expect(204);

      await second.get(ME_URL).expect(401);
      await first.get(ME_URL).expect(200);
    });
  });

  describe('регресс: хеш пароля не покидает сервер', () => {
    it('не встречается ни в одном ответе auth-роутов', async () => {
      const agent = testApp.createAgent();

      const registered = await agent.post(REGISTER_URL).send(USER).expect(201);
      const loggedIn = await agent
        .post(LOGIN_URL)
        .send({ email: USER.email, password: USER.password })
        .expect(200);
      const me = await agent.get(ME_URL).expect(200);

      // findFirst по той же причине, что и выше: email больше не @unique в схеме.
      const stored = await testApp.prisma.user.findFirst({ where: { email: USER.email } });
      const passwordHash = stored?.passwordHash;

      expect(passwordHash).toEqual(expect.any(String));

      for (const response of [registered, loggedIn, me]) {
        const body = JSON.stringify(response.body);

        // Проверка идёт по СЫРОМУ телу, а не по отсутствию ключа `passwordHash`. Утекает
        // именно сериализованный ответ, и уехать хеш может под любым именем — вложенным
        // объектом, полем `password`, куском спреда. Ищем и ключ, и само значение.
        expect(body).not.toContain('passwordHash');
        expect(body).not.toContain(passwordHash);
        expect(body).not.toContain(USER.password);
      }
    });
  });
});
