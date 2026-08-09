import {
  addBoardMember,
  boardElementsUrl,
  BOARDS_URL,
  boardUrl,
  createBoard,
  elementBody,
  elementId,
  elementUrl,
  MISSING_BOARD_ID,
  parseBoardListResponse,
  parseBoardResponse,
  type SignedUpUser,
  signUp,
  USER_A,
  USER_B,
} from './helpers/api';
import { startTestApp, type TestApp } from './helpers/test-app';

/**
 * Сквозные тесты досок: настоящий HTTP поверх настоящих Postgres и Redis.
 *
 * Юниты BoardService уже отвечают на вопрос «правильно ли рассуждает сервис», поэтому здесь
 * проверяется другое — доходит ли его решение до клиента через весь стек и лежит ли в базе то,
 * что обещал ответ. Между сервисом и клиентом находится ровно то, что юнитом не проверяется:
 * guard, сессия, ParseUUIDPipe, ValidationPipe, статус-коды, сериализация и настоящие
 * ограничения БД вроде каскада.
 *
 * Два пользователя заводятся в КАЖДОМ тесте, а не один на файл: владение — главное свойство
 * этого блока, и «чужой» ресурс должен быть настоящим чужим ресурсом, а не выдуманным id.
 */
describe('Board (e2e)', () => {
  let testApp: TestApp;
  let anna: SignedUpUser;
  let boris: SignedUpUser;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    // Проверка на undefined не лишняя: упади startTestApp (нет Docker, не встали миграции) —
    // afterAll всё равно вызовется, и обращение к полю дало бы вторую ошибку поверх настоящей.
    await testApp?.stop();
  });

  beforeEach(async () => {
    await testApp.reset();

    anna = await signUp(testApp, USER_A);
    boris = await signUp(testApp, USER_B);
  });

  describe(`POST ${BOARDS_URL}`, () => {
    it('создаёт доску, владельцем ставит автора сессии и кладёт её в базу', async () => {
      const response = await anna.agent.post(BOARDS_URL).send({ title: 'Sprint board' });

      expect(response.status).toBe(201);
      // Контракт из @slate/shared-types — до сверки значений: `toEqual` ниже проверяет, что
      // сервер сохранил присланное название, а схема — что форма ответа та, которую пакет
      // обещает клиенту (строгая: `ownerId` или `version` в теле уронили бы её).
      expect(() => parseBoardResponse(response.body)).not.toThrow();
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        title: 'Sprint board',
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });

      // Ответ мог бы быть правильным и без записи в базу — проверяем факт, а не отчёт о нём.
      // ownerId наружу не отдаётся вовсе, так что владение видно только отсюда.
      const stored = await testApp.prisma.board.findUnique({
        where: { id: (response.body as { id: string }).id },
      });

      expect(stored?.ownerId).toBe(anna.userId);
      expect(stored?.version).toBe(0);
    });

    it('не даёт назначить владельцем другого пользователя через тело запроса', async () => {
      // ownerId в CreateBoardDto не объявлен, поэтому ValidationPipe({ whitelist: true })
      // срезает его ещё до контроллера. Проверяем именно результат: доска всё равно моя.
      const response = await anna.agent
        .post(BOARDS_URL)
        .send({ title: 'Sprint board', ownerId: boris.userId });

      expect(response.status).toBe(201);

      const stored = await testApp.prisma.board.findUnique({
        where: { id: (response.body as { id: string }).id },
      });

      expect(stored?.ownerId).toBe(anna.userId);
    });

    it('отвергает пустое название', async () => {
      const response = await anna.agent.post(BOARDS_URL).send({ title: '' });

      expect(response.status).toBe(400);
    });
  });

  describe(`GET ${BOARDS_URL}`, () => {
    it('отдаёт только доски автора сессии', async () => {
      const mine = await createBoard(anna.agent, 'Моя доска');
      const foreign = await createBoard(boris.agent, 'Чужая доска');

      const response = await anna.agent.get(BOARDS_URL);
      const ids = parseBoardListResponse(response.body).map((board) => board.id);

      expect(response.status).toBe(200);
      expect(ids).toEqual([mine.id]);
      // Явная проверка на отсутствие, а не только на длину: список мог бы совпасть по размеру
      // и при этом содержать не ту доску.
      expect(ids).not.toContain(foreign.id);
    });

    it('на пустой аккаунт отдаёт пустой массив, а не ошибку', async () => {
      const response = await anna.agent.get(BOARDS_URL);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe(`GET ${BOARDS_URL}/:id`, () => {
    it('отдаёт метаданные своей доски', async () => {
      const board = await createBoard(anna.agent);

      const response = await anna.agent.get(boardUrl(board.id));

      expect(response.status).toBe(200);
      expect(response.body).toEqual(board);
    });

    it('на несуществующую доску отвечает 404', async () => {
      const response = await anna.agent.get(boardUrl(MISSING_BOARD_ID));

      expect(response.status).toBe(404);
    });

    it('на мусорный id отвечает 400, а не 500', async () => {
      // ParseUUIDPipe отбивает запрос до слоя данных. Без него Prisma уронила бы конвертацию
      // @db.Uuid, и кривая ссылка в браузере давала бы пятисотку.
      const response = await anna.agent.get(boardUrl('not-a-uuid'));

      expect(response.status).toBe(400);
    });
  });

  describe(`PATCH ${BOARDS_URL}/:id`, () => {
    it('переименовывает доску и инкрементит version', async () => {
      const board = await createBoard(anna.agent, 'Было');

      const response = await anna.agent.patch(boardUrl(board.id)).send({ title: 'Стало' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: board.id, title: 'Стало' });

      // version наружу не отдаётся, но расти обязан: на этот счётчик обопрётся оптимистическая
      // блокировка этапа 3, и пропущенный инкремент сломал бы её незаметно.
      const stored = await testApp.prisma.board.findUnique({ where: { id: board.id } });

      expect(stored?.title).toBe('Стало');
      expect(stored?.version).toBe(1);
    });

    it('отвергает пустое название', async () => {
      const board = await createBoard(anna.agent);

      const response = await anna.agent.patch(boardUrl(board.id)).send({ title: '' });

      expect(response.status).toBe(400);
    });
  });

  describe(`DELETE ${BOARDS_URL}/:id`, () => {
    it('удаляет доску насовсем: 204, и она больше не читается', async () => {
      const board = await createBoard(anna.agent);

      const response = await anna.agent.delete(boardUrl(board.id));

      expect(response.status).toBe(204);
      // У доски удаление жёсткое, в отличие от элемента: строки после него не остаётся.
      expect(response.body).toEqual({});

      const afterDelete = await anna.agent.get(boardUrl(board.id));

      expect(afterDelete.status).toBe(404);
      await expect(
        testApp.prisma.board.findUnique({ where: { id: board.id } }),
      ).resolves.toBeNull();
    });

    it('на несуществующую доску отвечает 404', async () => {
      const response = await anna.agent.delete(boardUrl(MISSING_BOARD_ID));

      expect(response.status).toBe(404);
    });

    it('уносит элементы доски каскадом — проверка прямым запросом в БД', async () => {
      const board = await createBoard(anna.agent);

      await anna.agent.put(elementUrl(elementId(1))).send(elementBody(board.id));
      await anna.agent.put(elementUrl(elementId(2))).send(elementBody(board.id, { order: 2 }));

      // Один из элементов заранее мягко удалён: у такой строки выставлен deletedAt, но сама она
      // остаётся в таблице — и каскад обязан унести её тоже, иначе осиротеют именно мягко
      // удалённые элементы, которых через HTTP не видно вообще никогда.
      await anna.agent.delete(elementUrl(elementId(2)));

      expect(await testApp.prisma.element.count({ where: { boardId: board.id } })).toBe(2);

      const response = await anna.agent.delete(boardUrl(board.id));

      expect(response.status).toBe(204);

      // Через HTTP это не проверить: доски больше нет, а значит нет и эндпоинта, который отдал
      // бы её содержимое. Осиротевшие строки существовали бы молча — их видно только из БД.
      expect(await testApp.prisma.element.count({ where: { boardId: board.id } })).toBe(0);
    });
  });

  describe(`GET ${BOARDS_URL}/:id/elements`, () => {
    it('на пустую доску отдаёт 200 и пустой массив', async () => {
      const board = await createBoard(anna.agent);

      const response = await anna.agent.get(boardElementsUrl(board.id));

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('на несуществующую доску отвечает 404, а не пустым массивом', async () => {
      // Разница принципиальна для клиента: [] означает «открывай пустой холст», 404 — «уходи с
      // экрана доски». Замаскируй мы отсутствие доски пустым списком, пользователь рисовал бы
      // в никуда, а сохранение падало бы позже и без объяснений.
      const response = await anna.agent.get(boardElementsUrl(MISSING_BOARD_ID));

      expect(response.status).toBe(404);
    });

    it('отдаёт элементы в порядке отрисовки', async () => {
      const board = await createBoard(anna.agent);

      // Кладём в обратном порядке — чтобы сортировка была видна, а не совпала с порядком вставки.
      await anna.agent.put(elementUrl(elementId(2))).send(elementBody(board.id, { order: 2 }));
      await anna.agent.put(elementUrl(elementId(1))).send(elementBody(board.id, { order: 1 }));

      const response = await anna.agent.get(boardElementsUrl(board.id));
      const ids = (response.body as { id: string }[]).map((element) => element.id);

      expect(response.status).toBe(200);
      expect(ids).toEqual([elementId(1), elementId(2)]);
    });
  });

  describe('owner-изоляция: чужие доски не существуют', () => {
    it('не показывает доску Анны в списке Бориса', async () => {
      const board = await createBoard(anna.agent);

      const response = await boris.agent.get(BOARDS_URL);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(JSON.stringify(response.body)).not.toContain(board.id);
    });

    it('отвечает 404 на чтение, изменение и удаление чужой доски', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');

      // Запросы идут ПОСЛЕДОВАТЕЛЬНО, а не через Promise.all. Supertest поднимает эфемерный
      // listen на каждый запрос к неслушающему серверу, и параллельные вызовы дерутся за него,
      // изредка отдавая ECONNRESET. Флаки-падение в тесте про безопасность — худший вид шума:
      // ему перестают верить.
      const attempts = [
        () => boris.agent.get(boardUrl(board.id)),
        () => boris.agent.get(boardElementsUrl(board.id)),
        () => boris.agent.patch(boardUrl(board.id)).send({ title: 'Захвачено' }),
        () => boris.agent.delete(boardUrl(board.id)),
      ];

      // Именно 404, а не 403: 403 подтверждал бы существование доски, и перебором id занятые
      // идентификаторы отличались бы от свободных. Для Бориса доска Анны НЕ СУЩЕСТВУЕТ.
      for (const attempt of attempts) {
        expect((await attempt()).status).toBe(404);
      }

      // И ни одна из попыток не должна была ничего изменить.
      const stored = await testApp.prisma.board.findUnique({ where: { id: board.id } });

      expect(stored?.title).toBe('Доска Анны');
      expect(stored?.version).toBe(0);
    });

    it('отвечает на чужую и на несуществующую доску одинаково', async () => {
      const board = await createBoard(anna.agent);

      const foreign = await boris.agent.get(boardUrl(board.id));
      const missing = await boris.agent.get(boardUrl(MISSING_BOARD_ID));

      // Совпадать обязаны и статус, и текст: разные формулировки раскрыли бы ровно то, что
      // скрывает одинаковый статус.
      expect(foreign.status).toBe(missing.status);
      expect(foreign.body).toEqual(missing.body);
    });
  });

  describe('участники доски (SLT-41)', () => {
    /** Member заводится напрямую через Prisma — API приглашений появится в SLT-42. */
    it('viewer читает метаданные и содержимое чужой доски', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await addBoardMember(testApp, board.id, boris.userId, 'viewer');

      const boardResponse = await boris.agent.get(boardUrl(board.id));
      const elementsResponse = await boris.agent.get(boardElementsUrl(board.id));

      expect(boardResponse.status).toBe(200);
      expect(boardResponse.body).toEqual(board);
      expect(elementsResponse.status).toBe(200);
      expect(elementsResponse.body).toEqual([]);
    });

    it('editor тоже читает доску, но переименовать/удалить её не может — жизненный цикл доски владелец-only', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await addBoardMember(testApp, board.id, boris.userId, 'editor');

      const readResponse = await boris.agent.get(boardUrl(board.id));
      // Та же причина, что у viewer'а ниже: SLT-41 требует роль ≥ editor только для мутаций
      // ЭЛЕМЕНТОВ (см. element.e2e-spec) — управление самой доской editor'у не передавалось.
      const renamed = await boris.agent.patch(boardUrl(board.id)).send({ title: 'Захвачено' });
      const deleted = await boris.agent.delete(boardUrl(board.id));

      expect(readResponse.status).toBe(200);
      expect(renamed.status).toBe(404);
      expect(deleted.status).toBe(404);

      const stored = await testApp.prisma.board.findUnique({ where: { id: board.id } });

      expect(stored?.title).toBe('Доска Анны');
    });

    it('viewer тем более не может переименовать или удалить доску', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await addBoardMember(testApp, board.id, boris.userId, 'viewer');

      const renamed = await boris.agent.patch(boardUrl(board.id)).send({ title: 'Захвачено' });
      const deleted = await boris.agent.delete(boardUrl(board.id));

      expect(renamed.status).toBe(404);
      expect(deleted.status).toBe(404);
    });

    it('посторонний по-прежнему не видит доску с чужими участниками — регресс изоляции', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await addBoardMember(testApp, board.id, boris.userId, 'editor');
      const carla = await signUp(testApp, {
        email: 'carla@example.test',
        displayName: 'Carla',
        password: 'yet another horse',
      });

      const response = await carla.agent.get(boardUrl(board.id));

      expect(response.status).toBe(404);
    });

    it('viewer появляется в GET /boards как shared, с ролью viewer (SLT-42)', async () => {
      const board = await createBoard(anna.agent, 'Доска Анны');
      await addBoardMember(testApp, board.id, boris.userId, 'viewer');

      const response = await boris.agent.get(BOARDS_URL);

      // owned ∪ shared (SLT-42) — union и роль по каждой доске проверены подробнее в
      // board-member.e2e-spec; здесь — регресс-подтверждение, что доступ по SLT-41 отражается
      // в списке.
      expect(parseBoardListResponse(response.body)).toEqual([{ ...board, role: 'viewer' }]);
    });
  });

  describe('без сессии', () => {
    it('закрывает все board-роуты 401-м', async () => {
      const board = await createBoard(anna.agent);
      const anonymous = testApp.createAgent();

      const attempts = [
        () => anonymous.get(BOARDS_URL),
        () => anonymous.post(BOARDS_URL).send({ title: 'Ничьё' }),
        () => anonymous.get(boardUrl(board.id)),
        () => anonymous.get(boardElementsUrl(board.id)),
        () => anonymous.patch(boardUrl(board.id)).send({ title: 'Ничьё' }),
        () => anonymous.delete(boardUrl(board.id)),
      ];

      // 401 на КАЖДОМ роуте, а не «на одном для примера»: @Authorization() висит на классе
      // контроллера именно затем, чтобы новый роут закрывался сам собой, — и проверять это
      // нужно поимённо, иначе однажды добавленный незакрытый роут никто не заметит.
      for (const attempt of attempts) {
        expect((await attempt()).status).toBe(401);
      }
    });
  });

  describe('регресс: version не покидает сервер', () => {
    it('не отдаёт version ни в одном ответе про доску', async () => {
      const created = await anna.agent.post(BOARDS_URL).send({ title: 'Sprint board' });
      const boardId = (created.body as { id: string }).id;

      const list = await anna.agent.get(BOARDS_URL);
      const one = await anna.agent.get(boardUrl(boardId));
      const patched = await anna.agent.patch(boardUrl(boardId)).send({ title: 'Другое' });

      // Счётчик ревизий — внутреннее состояние: отдай мы его наружу, клиент начал бы на него
      // опираться раньше, чем появится оптимистическая блокировка (этап 3), и мы получили бы
      // публичный контракт там, где нужна свобода менять реализацию.
      expect(JSON.stringify([created.body, list.body, one.body, patched.body])).not.toContain(
        'version',
      );
    });
  });
});
