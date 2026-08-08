import { ElementRepository } from '../src/modules/element/element.repository';
import {
  addBoardMember,
  boardElementsUrl,
  type BoardResponse,
  createBoard,
  elementBody,
  elementId,
  elementUrl,
  LINE_DATA,
  MISSING_BOARD_ID,
  MISSING_ELEMENT_ID,
  parseElementListResponse,
  parseElementResponse,
  type SignedUpUser,
  signUp,
  USER_A,
  USER_B,
} from './helpers/api';
import { startTestApp, type TestApp } from './helpers/test-app';

/** Один id на весь файл: элементы живут в изолированных досках, а база чистится между тестами. */
const ELEMENT_ID = elementId(1);

/**
 * Сквозные тесты элементов холста.
 *
 * Главное, что проверяется здесь и не проверяется юнитами, — поведение мягкого удаления на
 * ЖИВОЙ базе: юнит видит вызов репозитория, но не видит, что удалённая строка действительно
 * пропала из выдачи доски, осталась в таблице и воскресла тем же PUT.
 */
describe('Element (e2e)', () => {
  let testApp: TestApp;
  let anna: SignedUpUser;
  let boris: SignedUpUser;
  let board: BoardResponse;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    await testApp?.stop();
  });

  beforeEach(async () => {
    await testApp.reset();

    anna = await signUp(testApp, USER_A);
    boris = await signUp(testApp, USER_B);
    board = await createBoard(anna.agent);
  });

  /** Живое содержимое доски глазами клиента — то, что рисует холст. */
  async function liveElementIds(): Promise<string[]> {
    const response = await anna.agent.get(boardElementsUrl(board.id));

    // Разбор схемой, а не `as`: список содержимого доски — то, что рисует холст, и его форма
    // обязана совпадать с контрактом при КАЖДОМ обращении, а не только в тесте про создание.
    return parseElementListResponse(response.body).map((element) => element.id);
  }

  describe('PUT /api/elements/:id — создание', () => {
    it('создаёт элемент с клиентским id и отвечает 201', async () => {
      const response = await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      // 201, а не 200: ресурс действительно создан (RFC 9110 §9.3.4). Для autosave это
      // бесплатное различение «долетело впервые» и «обновилось».
      expect(response.status).toBe(201);
      // Сначала контракт (форма, типы, отсутствие лишних полей — schema строгая), потом
      // значения. Порядок важен: `toEqual` ниже проверяет, что сервер записал именно то, что
      // прислали, а вот про утечку `version` или `deletedAt` он сказал бы то же самое, что и
      // про любое другое расхождение, — «объекты не равны».
      expect(() => parseElementResponse(response.body)).not.toThrow();
      expect(response.body).toEqual({
        id: ELEMENT_ID,
        boardId: board.id,
        type: 'rect',
        x: 10,
        y: 20,
        angle: 0,
        opacity: 1,
        stroke: '#1e1e1e',
        // fill в теле не присылали — сервер обязан записать явный null, а не оставить поле без
        // значения: PUT заменяет фигуру целиком.
        fill: null,
        strokeWidth: 2,
        seed: 42,
        order: 1,
        data: { width: 120, height: 80 },
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      // id пришёл из URL и попал в первичный ключ как есть — БД его не генерировала.
      expect(stored?.id).toBe(ELEMENT_ID);
      expect(stored?.version).toBe(0);
      expect(stored?.deletedAt).toBeNull();
      expect(await liveElementIds()).toEqual([ELEMENT_ID]);
    });

    it('отвергает data, не соответствующую типу фигуры', async () => {
      // Форму jsonb не проверит ни Postgres, ни class-validator — только дискриминированная
      // схема. Без неё на холст попал бы rect с points внутри, и упал бы рендер у клиента.
      const response = await anna.agent
        .put(elementUrl(ELEMENT_ID))
        .send(elementBody(board.id, { data: LINE_DATA }));

      expect(response.status).toBe(400);
      await expect(
        testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } }),
      ).resolves.toBeNull();
    });

    it('на мусорный id в URL отвечает 400, а не 500', async () => {
      const response = await anna.agent.put(elementUrl('not-a-uuid')).send(elementBody(board.id));

      expect(response.status).toBe(400);
    });

    it('на несуществующую доску в теле отвечает 404', async () => {
      const response = await anna.agent
        .put(elementUrl(ELEMENT_ID))
        .send(elementBody(MISSING_BOARD_ID));

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/elements/:id — замена', () => {
    it('заменяет элемент по тому же id, а не создаёт второй', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const response = await anna.agent
        .put(elementUrl(ELEMENT_ID))
        .send(elementBody(board.id, { x: 99, stroke: '#ff0000', data: { width: 5, height: 5 } }));

      // 200 — заменён. Тот же id, то есть повторный autosave не плодит фигуры.
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: ELEMENT_ID,
        x: 99,
        stroke: '#ff0000',
        data: { width: 5, height: 5 },
      });

      expect(await testApp.prisma.element.count({ where: { boardId: board.id } })).toBe(1);

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.version).toBe(1);
    });

    it('запрещает менять тип существующего элемента', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const response = await anna.agent
        .put(elementUrl(ELEMENT_ID))
        .send(elementBody(board.id, { type: 'line', data: LINE_DATA }));

      // 409, а не 400: тело безупречно — type и data согласованы между собой. Не сходится
      // состояние: под этим id уже лежит фигура другой природы.
      expect(response.status).toBe(409);

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.type).toBe('rect');
      // Отказ обязан быть полным: ни тип, ни ревизия не сдвинулись.
      expect(stored?.version).toBe(0);
    });
  });

  describe('DELETE /api/elements/:id — мягкое удаление', () => {
    it('убирает элемент из содержимого доски, но оставляет строку в таблице', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const response = await anna.agent.delete(elementUrl(ELEMENT_ID));

      expect(response.status).toBe(204);
      // Для клиента фигура исчезла с холста — обратимость наружу не видна.
      expect(await liveElementIds()).toEqual([]);

      // А в базе строка на месте: удаление обратимо, и это единственное место, откуда видно
      // разницу между мягким удалением и настоящим DELETE.
      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored).not.toBeNull();
      expect(stored?.deletedAt).toBeInstanceOf(Date);
    });

    it('повторное удаление отвечает 404 и не переставляет время удаления', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      await anna.agent.delete(elementUrl(ELEMENT_ID));

      const deletedAt = (await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } }))
        ?.deletedAt;

      const response = await anna.agent.delete(elementUrl(ELEMENT_ID));

      expect(response.status).toBe(404);

      // Ретрай клиента не должен менять «когда удалили»: на это время обопрётся отмена
      // удаления в реалтайме (этап 3).
      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.deletedAt).toEqual(deletedAt);
    });

    it('на несуществующий элемент отвечает 404', async () => {
      const response = await anna.agent.delete(elementUrl(MISSING_ELEMENT_ID));

      expect(response.status).toBe(404);
    });

    it('воскрешает мягко удалённый элемент тем же PUT', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      await anna.agent.delete(elementUrl(ELEMENT_ID));

      const response = await anna.agent
        .put(elementUrl(ELEMENT_ID))
        .send(elementBody(board.id, { x: 77 }));

      // 200, а не 201: строка существовала всё это время, PUT её заменил и снял deletedAt.
      // Отдельного restore-эндпоинта нет намеренно — undo это «нарисовать фигуру обратно».
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: ELEMENT_ID, x: 77 });
      expect(await liveElementIds()).toEqual([ELEMENT_ID]);

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.deletedAt).toBeNull();
    });

    it('не даёт воскресить элемент со сменой типа', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      await anna.agent.delete(elementUrl(ELEMENT_ID));

      const response = await anna.agent
        .put(elementUrl(ELEMENT_ID))
        .send(elementBody(board.id, { type: 'line', data: LINE_DATA }));

      // Тип удалённой строки сохранён, значит инвариант действует и на воскрешении: undo
      // возвращает ТУ ЖЕ фигуру, а не другую под её идентификатором.
      expect(response.status).toBe(409);
      expect(await liveElementIds()).toEqual([]);
    });
  });

  describe('PATCH /api/elements/:id', () => {
    it('меняет только присланные поля и инкрементит version', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const response = await anna.agent.patch(elementUrl(ELEMENT_ID)).send({ x: 99, y: 140 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: ELEMENT_ID,
        x: 99,
        y: 140,
        // Остального не присылали — оно обязано остаться прежним, иначе PATCH был бы заменой.
        stroke: '#1e1e1e',
        strokeWidth: 2,
        seed: 42,
        order: 1,
        data: { width: 120, height: 80 },
      });

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.version).toBe(1);
      expect(stored?.type).toBe('rect');
      expect(stored?.boardId).toBe(board.id);
    });

    it('игнорирует попытку сменить доску, тип или id через тело', async () => {
      const otherBoard = await createBoard(anna.agent, 'Вторая доска');

      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const response = await anna.agent
        .patch(elementUrl(ELEMENT_ID))
        .send({ x: 1, id: elementId(9), boardId: otherBoard.id, type: 'line' });

      // Этих полей нет в PatchElementDto, поэтому whitelist срезает их до контроллера: то,
      // чего нет во входе, нельзя ни забыть проверить, ни обойти.
      expect(response.status).toBe(200);

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.boardId).toBe(board.id);
      expect(stored?.type).toBe('rect');
      expect(await liveElementIds()).toEqual([ELEMENT_ID]);
    });

    it('отвергает пустое тело', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const response = await anna.agent.patch(elementUrl(ELEMENT_ID)).send({});

      // Пустой PATCH ничего не менял бы, но инкрементил version и трогал updatedAt — тихо
      // портил бы данные вместо честного отказа.
      expect(response.status).toBe(400);
    });

    it('отвергает геометрию, не соответствующую типу хранимого элемента', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      // type в PATCH не приходит, поэтому форму data сервер сверяет с типом строки в БД.
      const response = await anna.agent.patch(elementUrl(ELEMENT_ID)).send({ data: LINE_DATA });

      expect(response.status).toBe(400);
    });

    it('не патчит мягко удалённый элемент', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      await anna.agent.delete(elementUrl(ELEMENT_ID));

      const response = await anna.agent.patch(elementUrl(ELEMENT_ID)).send({ x: 99 });

      // Воскрешать через PATCH нельзя — для этого есть PUT с полным телом.
      expect(response.status).toBe(404);
    });
  });

  describe('owner-изоляция: чужие элементы не существуют', () => {
    it('не даёт Борису писать в доску Анны', async () => {
      const response = await boris.agent.put(elementUrl(elementId(5))).send(elementBody(board.id));

      // 404 про доску: для Бориса её нет, а значит нет и места, куда класть элемент.
      expect(response.status).toBe(404);
      await expect(
        testApp.prisma.element.findUnique({ where: { id: elementId(5) } }),
      ).resolves.toBeNull();
    });

    it('не даёт Борису менять и удалять элементы Анны', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      // Последовательно, а не через Promise.all: supertest поднимает эфемерный listen на
      // каждый запрос, и параллельные вызовы к одному серверу изредка дают ECONNRESET.
      const patched = await boris.agent.patch(elementUrl(ELEMENT_ID)).send({ x: 999 });
      const deleted = await boris.agent.delete(elementUrl(ELEMENT_ID));

      expect(patched.status).toBe(404);
      expect(deleted.status).toBe(404);

      // Ни одна попытка не должна была ничего изменить: элемент цел, жив и не сдвинут.
      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.x).toBe(10);
      expect(stored?.deletedAt).toBeNull();
      expect(stored?.version).toBe(0);
    });

    it('не даёт Борису занять чужой идентификатор своей фигурой', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const borisBoard = await createBoard(boris.agent, 'Доска Бориса');
      const response = await boris.agent
        .put(elementUrl(ELEMENT_ID))
        .send(elementBody(borisBoard.id));

      // Элемент Анны Борису не виден, поэтому сервер идёт создавать — и упирается в занятый
      // первичный ключ. 409 с нейтральным текстом: чей именно это элемент, ответ не выдаёт.
      expect(response.status).toBe(409);

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.boardId).toBe(board.id);
    });
  });

  describe('участники доски: роли editor/viewer (SLT-41)', () => {
    /**
     * Ровно то, что требуют решения SLT-41: editor пишет наравне с owner, viewer читает, но
     * получает отказ на запись, посторонний (не-member) по-прежнему не видит доску вовсе.
     * Member заводится напрямую через Prisma (`addBoardMember`) — API приглашений (SLT-42) ещё
     * нет, а тест не должен ждать его появления, чтобы проверить уже реализованное чтение member'ов.
     */
    it('editor создаёт, обновляет и удаляет элементы на чужой доске', async () => {
      await addBoardMember(testApp, board.id, boris.userId, 'editor');

      const created = await boris.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      const patched = await boris.agent.patch(elementUrl(ELEMENT_ID)).send({ x: 500 });
      const deleted = await boris.agent.delete(elementUrl(ELEMENT_ID));

      expect(created.status).toBe(201);
      expect(patched.status).toBe(200);
      expect(deleted.status).toBe(204);
      expect(await liveElementIds()).toEqual([]);
    });

    it('viewer читает содержимое доски, созданное владельцем', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      await addBoardMember(testApp, board.id, boris.userId, 'viewer');

      const response = await boris.agent.get(boardElementsUrl(board.id));

      expect(response.status).toBe(200);
      expect(parseElementListResponse(response.body).map((element) => element.id)).toEqual([
        ELEMENT_ID,
      ]);
    });

    it('viewer получает 403 на PUT/PATCH/DELETE — доска видна, писать нельзя', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      await addBoardMember(testApp, board.id, boris.userId, 'viewer');

      // Последовательно — та же причина, что и в owner-изоляции: параллельные запросы к
      // supertest-серверу изредка дают ECONNRESET.
      const created = await boris.agent.put(elementUrl(elementId(9))).send(elementBody(board.id));
      const patched = await boris.agent.patch(elementUrl(ELEMENT_ID)).send({ x: 999 });
      const deleted = await boris.agent.delete(elementUrl(ELEMENT_ID));

      // 403, а НЕ 404: viewer'у доска и элемент видны (он их только что прочитал бы через GET),
      // так что 404 здесь соврал бы про причину отказа — та же логика, что различает
      // forbiddenWrite и boardNotFound в ElementService (SLT-41).
      expect(created.status).toBe(403);
      expect(patched.status).toBe(403);
      expect(deleted.status).toBe(403);

      // Ничего не изменилось и не появилось.
      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      expect(stored?.x).toBe(10);
      expect(stored?.deletedAt).toBeNull();
      await expect(
        testApp.prisma.element.findUnique({ where: { id: elementId(9) } }),
      ).resolves.toBeNull();
    });

    it('посторонний по-прежнему получает 404 на доску с чужими участниками', async () => {
      // Регресс изоляции (SLT-41): наличие ЛЮБЫХ участников на доске не должно приоткрыть её
      // третьему лицу — scope сравнивает userId, а не «есть ли вообще кто-то в BoardMember».
      await addBoardMember(testApp, board.id, boris.userId, 'editor');
      const carla = await signUp(testApp, {
        email: 'carla@example.test',
        displayName: 'Carla',
        password: 'yet another horse',
      });

      const response = await carla.agent.get(boardElementsUrl(board.id));

      expect(response.status).toBe(404);
    });
  });

  describe('регресс: version и deletedAt не покидают PUT/PATCH-ответы', () => {
    it('не отдаёт служебные поля в ответах на мутации элемента', async () => {
      const created = await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      const replaced = await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));
      const patched = await anna.agent.patch(elementUrl(ELEMENT_ID)).send({ x: 5 });

      const raw = JSON.stringify([created.body, replaced.body, patched.body]);

      // deletedAt наружу не нужен вовсе: выдача и так возвращает только живые элементы, так
      // что поле было бы константным null — байтами, которые ничего не сообщают, зато
      // приглашают клиента написать собственную проверку удалённости вместо серверной. `version`
      // мутации по-прежнему прячут (SLT-38/39/40): оптимистическая блокировка едет только по WS —
      // PUT/PATCH её не проверяют и клиенту для них не нужны, версии здесь взяться неоткуда.
      expect(raw).not.toContain('version');
      expect(raw).not.toContain('deletedAt');
    });

    it('deletedAt не покидает GET-список тоже — version в нём легален (SLT-40)', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const list = await anna.agent.get(boardElementsUrl(board.id));

      expect(JSON.stringify(list.body)).not.toContain('deletedAt');
    });
  });

  describe('GET /boards/:id/elements отдаёт version (SLT-40)', () => {
    it('версия свежесозданного элемента — 0, растёт с каждой WS/HTTP-мутацией', async () => {
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const [created] = parseElementListResponse(
        (await anna.agent.get(boardElementsUrl(board.id))).body,
      );

      expect(created?.version).toBe(0);

      await anna.agent.patch(elementUrl(ELEMENT_ID)).send({ x: 99 });

      const [patched] = parseElementListResponse(
        (await anna.agent.get(boardElementsUrl(board.id))).body,
      );

      // Гидрация приносит АКТУАЛЬНУЮ version — иначе первая WS-правка старого элемента
      // получила бы ложный version_conflict от сервера (долг SLT-39, закрытый здесь).
      expect(patched?.version).toBe(1);
    });
  });

  describe('оптимистическая блокировка WS-мутаций на живой БД (SLT-38)', () => {
    it('из двух конкурентных versioned-update с одной version применяется РОВНО один', async () => {
      // Против настоящего Postgres, не мока: юнит (element.repository.spec) доказывает форму
      // WHERE живым фейком Prisma, а этот тест — что сама СУБД действительно сериализует два
      // UPDATE на одну строку и вторая команда реально не находит строку под устаревшей version,
      // а не что мы правильно угадали поведение Prisma/Postgres в голове.
      await anna.agent.put(elementUrl(ELEMENT_ID)).send(elementBody(board.id));

      const repository = new ElementRepository(testApp.prisma);

      const [first, second] = await Promise.all([
        repository.patchAccessibleVersioned(ELEMENT_ID, anna.userId, 0, { x: 111 }),
        repository.patchAccessibleVersioned(ELEMENT_ID, anna.userId, 0, { x: 222 }),
      ]);

      const applied = [first, second].filter((result) => result !== null);
      const rejected = [first, second].filter((result) => result === null);

      // Ровно один выигрывает гонку — read-then-write дал бы шанс обоим применить свою правку.
      expect(applied).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const stored = await testApp.prisma.element.findUnique({ where: { id: ELEMENT_ID } });

      // Один-единственный инкремент, не два: подтверждает, что вторая команда не задела строку
      // вовсе (а не «применилась поверх», просто без видимого эффекта на x).
      expect(stored?.version).toBe(1);
      // Итоговый x — от выигравшей команды, какая бы из двух ни победила по MVCC-порядку.
      expect(stored?.x).toBe(applied[0]?.x);
    });
  });
});
