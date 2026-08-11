import { Prisma } from '@slate/database';

import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ELEMENT_ORDER_BY, ELEMENT_SELECT } from '../element/entities/element.entity';
import { BoardRepository } from './board.repository';
import { BOARD_SELECT } from './entities/board.entity';

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const TITLE = 'Sprint board';
const CREATED_AT = new Date('2026-07-29T10:00:00.000Z');
const UPDATED_AT = new Date('2026-07-30T12:00:00.000Z');

/**
 * Ожидаемая область видимости ЧТЕНИЯ конкретной доски (owner ∪ участник любой роли, SLT-41).
 *
 * Форма выписана здесь буквально, а не взята вызовом `accessibleBoardScope(USER_ID)`. Иначе
 * тест повторял бы реализацию и остался бы зелёным при любой её правке — включая ту, что
 * открывает доступ ко всем доскам. Проверка доступа должна быть зафиксирована независимо.
 */
const ACCESS_SCOPED_WHERE = {
  id: BOARD_ID,
  OR: [{ ownerId: USER_ID }, { members: { some: { userId: USER_ID } } }],
};

/**
 * Область видимости ЗАПИСИ самой доски (переименование/удаление) — только владелец (SLT-41):
 * управление жизненным циклом доски editor'у не передаётся, в отличие от чтения и мутаций
 * элементов.
 */
const OWNER_ONLY_WHERE = { id: BOARD_ID, ownerId: USER_ID };

/**
 * Узкие сигнатуры вместо настоящих делегатов Prisma.
 *
 * Делегаты — обобщённые перегруженные методы, чей возвращаемый тип выводится из `select`
 * вызывающей стороны; воспроизводить их в моке значит воевать с выводом типов ради нулевой
 * пользы. Здесь важно ДРУГОЕ: с какими аргументами репозиторий обращается к БД. Аргументы
 * типизированы настоящими Prisma-типами (опечатка в `where` не скомпилируется), а результат —
 * `unknown`: его форму задаёт `select` в самом репозитории, и там её проверяет tsc.
 */
type BoardFindFirst = (args: Prisma.BoardFindFirstArgs) => Promise<unknown>;
type BoardFindMany = (args: Prisma.BoardFindManyArgs) => Promise<unknown>;
type BoardCreate = (args: Prisma.BoardCreateArgs) => Promise<unknown>;
type BoardUpdate = (args: Prisma.BoardUpdateArgs) => Promise<unknown>;
type BoardDelete = (args: Prisma.BoardDeleteArgs) => Promise<unknown>;

/** Ошибка «строка под условие не найдена» — то, чем Prisma отвечает на update/delete впустую. */
function recordNotFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('No record was found for an update', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

function createDependencies() {
  const findFirst = jest.fn() as jest.MockedFunction<BoardFindFirst>;
  const findMany = jest.fn() as jest.MockedFunction<BoardFindMany>;
  const create = jest.fn() as jest.MockedFunction<BoardCreate>;
  const update = jest.fn() as jest.MockedFunction<BoardUpdate>;
  // `delete` — ключевое слово, идентификатором быть не может.
  const deleteBoard = jest.fn() as jest.MockedFunction<BoardDelete>;

  // Единственный шов теста. Полноценный PrismaService подделать нельзя (приватное состояние и
  // десятки делегатов), а поднимать настоящий значит идти в БД — это e2e (SLT-21).
  const prisma = {
    board: { findFirst, findMany, create, update, delete: deleteBoard },
  } as unknown as PrismaService;

  return {
    boardRepository: new BoardRepository(prisma),
    findFirst,
    findMany,
    create,
    update,
    deleteBoard,
  };
}

describe('BoardRepository', () => {
  describe('create', () => {
    it('пишет ownerId из аргумента и не тянет из строки лишних полей', async () => {
      const { boardRepository, create } = createDependencies();
      create.mockResolvedValue({});

      await boardRepository.create({ ownerId: USER_ID, title: TITLE });

      // select обязателен и на вставке: без него Prisma вернёт всю строку, включая version.
      expect(create).toHaveBeenCalledWith({
        data: { ownerId: USER_ID, title: TITLE },
        select: BOARD_SELECT,
      });
    });

    it('без title оставляет колонку незаполненной — дефолт ставит БД', async () => {
      const { boardRepository, create } = createDependencies();
      create.mockResolvedValue({});

      await boardRepository.create({ ownerId: USER_ID });

      // undefined ⇒ колонки нет в INSERT ⇒ срабатывает @default("Untitled") из схемы.
      // Пустая строка или своя константа означали бы дефолт в двух местах.
      expect(create).toHaveBeenCalledWith({
        data: { ownerId: USER_ID, title: undefined },
        select: BOARD_SELECT,
      });
    });
  });

  describe('findAllAccessibleBy', () => {
    const SELECT_SHAPE = {
      // Без `id` в отличие от ACCESS_SCOPED_WHERE у findAccessible: это список, а не одна доска —
      // scope тот же (`accessibleBoardScope`), просто без сужения по конкретному id.
      where: { OR: [{ ownerId: USER_ID }, { members: { some: { userId: USER_ID } } }] },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: {
        ...BOARD_SELECT,
        ownerId: true,
        members: { where: { userId: USER_ID }, select: { role: true } },
      },
    };

    it('запрашивает owned ∪ shared (SLT-42) — тот же scope, что у findAccessible', async () => {
      const { boardRepository, findMany } = createDependencies();
      findMany.mockResolvedValue([]);

      await boardRepository.findAllAccessibleBy(USER_ID);

      expect(findMany).toHaveBeenCalledWith(SELECT_SHAPE);
    });

    it('владельцу отдаёт role: owner, не отдавая наружу ownerId/members', async () => {
      const { boardRepository, findMany } = createDependencies();
      findMany.mockResolvedValue([
        {
          id: BOARD_ID,
          title: TITLE,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
          ownerId: USER_ID,
          members: [],
        },
      ]);

      const result = await boardRepository.findAllAccessibleBy(USER_ID);

      // toEqual, а не toMatchObject: ownerId/members не должны утечь в результат так же, как
      // version не утекает из BOARD_SELECT.
      expect(result).toEqual([
        { id: BOARD_ID, title: TITLE, createdAt: CREATED_AT, updatedAt: UPDATED_AT, role: 'owner' },
      ]);
    });

    it('участнику отдаёт его роль членства (editor/viewer)', async () => {
      const { boardRepository, findMany } = createDependencies();
      findMany.mockResolvedValue([
        {
          id: BOARD_ID,
          title: TITLE,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
          ownerId: 'someone-else',
          members: [{ role: 'viewer' }],
        },
      ]);

      const result = await boardRepository.findAllAccessibleBy(USER_ID);

      expect(result).toEqual([
        {
          id: BOARD_ID,
          title: TITLE,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
          role: 'viewer',
        },
      ]);
    });
  });

  describe('findAccessible', () => {
    it('сужает выборку доской И её доступностью', async () => {
      const { boardRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue(null);

      await boardRepository.findAccessible(BOARD_ID, USER_ID);

      // Проверка доступа — часть условия запроса, а не отдельный if после чтения: чужая строка
      // не должна оказаться в памяти процесса даже на мгновение.
      expect(findFirst).toHaveBeenCalledWith({
        where: ACCESS_SCOPED_WHERE,
        select: BOARD_SELECT,
      });
    });

    it('возвращает null, когда под scope ничего не нашлось', async () => {
      const { boardRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue(null);

      await expect(boardRepository.findAccessible(BOARD_ID, USER_ID)).resolves.toBeNull();
    });
  });

  describe('getAccessLevel', () => {
    const SELECT_SHAPE = {
      where: ACCESS_SCOPED_WHERE,
      select: { ownerId: true, members: { where: { userId: USER_ID }, select: { role: true } } },
    };

    it('владельцу отдаёт owner, не заглядывая в members', async () => {
      const { boardRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ ownerId: USER_ID, members: [] });

      await expect(boardRepository.getAccessLevel(BOARD_ID, USER_ID)).resolves.toBe('owner');

      // Тот же access-scope, что и у findAccessible: единая точка доступа не заводит второй where.
      expect(findFirst).toHaveBeenCalledWith(SELECT_SHAPE);
    });

    it('участнику с ролью editor отдаёт editor', async () => {
      const { boardRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ ownerId: 'someone-else', members: [{ role: 'editor' }] });

      await expect(boardRepository.getAccessLevel(BOARD_ID, USER_ID)).resolves.toBe('editor');
    });

    it('участнику с ролью viewer отдаёт viewer', async () => {
      const { boardRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ ownerId: 'someone-else', members: [{ role: 'viewer' }] });

      await expect(boardRepository.getAccessLevel(BOARD_ID, USER_ID)).resolves.toBe('viewer');
    });

    it('постороннему или на несуществующую доску отдаёт null', async () => {
      const { boardRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue(null);

      await expect(boardRepository.getAccessLevel(BOARD_ID, USER_ID)).resolves.toBeNull();
    });
  });

  describe('findElements', () => {
    it('запрашивает только живые элементы (deletedAt IS NULL) в порядке отрисовки', async () => {
      const { boardRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ elements: [] });

      await boardRepository.findElements(BOARD_ID, USER_ID);

      // У Element в схеме soft delete: без фильтра на холсте появились бы фигуры, которые
      // пользователь удалил. Фильтр вложен в тот же access-scoped запрос — прочитать элементы
      // чужой доски мимо проверки нельзя.
      expect(findFirst).toHaveBeenCalledWith({
        where: ACCESS_SCOPED_WHERE,
        select: {
          elements: {
            where: { deletedAt: null },
            orderBy: ELEMENT_ORDER_BY,
            select: ELEMENT_SELECT,
          },
        },
      });
    });

    it('на недоступную доску отдаёт null, на пустую — пустой массив', async () => {
      const { boardRepository, findFirst } = createDependencies();

      findFirst.mockResolvedValue(null);
      await expect(boardRepository.findElements(BOARD_ID, USER_ID)).resolves.toBeNull();

      findFirst.mockResolvedValue({ elements: [] });
      await expect(boardRepository.findElements(BOARD_ID, USER_ID)).resolves.toEqual([]);
    });
  });

  describe('updateAccessible', () => {
    it('инкрементит version атомарно и ТОЛЬКО под владельцем (SLT-41: editor переименовать не может)', async () => {
      const { boardRepository, update } = createDependencies();
      update.mockResolvedValue({});

      await boardRepository.updateAccessible(BOARD_ID, USER_ID, { title: 'Renamed' });

      // `{ increment: 1 }`, а не `version: value + 1`: инкремент считает БД. Прочитать-прибавить-
      // записать потеряло бы ревизию при двух параллельных PATCH'ах, а на этот счётчик будет
      // опираться оптимистическая блокировка этапа 3.
      //
      // `where` — owner-only (`{ id, ownerId }`), НЕ ACCESS_SCOPED_WHERE: управление жизненным
      // циклом доски не входит в полномочия editor'а (SLT-41), в отличие от чтения и элементов.
      expect(update).toHaveBeenCalledWith({
        where: OWNER_ONLY_WHERE,
        data: { title: 'Renamed', version: { increment: 1 } },
        select: BOARD_SELECT,
      });
    });

    it('превращает «строки под условие нет» в null, а не в 500', async () => {
      const { boardRepository, update } = createDependencies();
      update.mockRejectedValue(recordNotFound());

      // P2025 здесь — это и «доски нет», и «доска чужая»: scope в условии, БД их не различает.
      await expect(
        boardRepository.updateAccessible(BOARD_ID, USER_ID, { title: 'Renamed' }),
      ).resolves.toBeNull();
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { boardRepository, update } = createDependencies();
      const connectionFailure = new Error('connection terminated');
      update.mockRejectedValue(connectionFailure);

      // Глотать всё подряд — значит отвечать 404 на упавшую базу и искать причину в логах фронта.
      await expect(
        boardRepository.updateAccessible(BOARD_ID, USER_ID, { title: 'Renamed' }),
      ).rejects.toBe(connectionFailure);
    });
  });

  describe('deleteAccessible', () => {
    it('удаляет ТОЛЬКО у владельца (SLT-41) и полагается на каскад БД', async () => {
      const { boardRepository, deleteBoard } = createDependencies();
      deleteBoard.mockResolvedValue({ id: BOARD_ID });

      await expect(boardRepository.deleteAccessible(BOARD_ID, USER_ID)).resolves.toBe(true);

      // Элементы и участников сносит ON DELETE CASCADE (миграция 20260725144536_init) — ни
      // транзакции, ни ручного удаления детей здесь нет и быть не должно.
      //
      // `where` — owner-only, та же причина, что у updateAccessible: удаление доски editor'у
      // не передаётся.
      expect(deleteBoard).toHaveBeenCalledWith({
        where: OWNER_ONLY_WHERE,
        select: { id: true },
      });
    });

    it('на чужую или отсутствующую доску возвращает false', async () => {
      const { boardRepository, deleteBoard } = createDependencies();
      deleteBoard.mockRejectedValue(recordNotFound());

      await expect(boardRepository.deleteAccessible(BOARD_ID, USER_ID)).resolves.toBe(false);
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { boardRepository, deleteBoard } = createDependencies();
      const foreignKeyFailure = new Prisma.PrismaClientKnownRequestError('FK violation', {
        code: 'P2003',
        clientVersion: 'test',
      });
      deleteBoard.mockRejectedValue(foreignKeyFailure);

      // Отдельно от P2025: пропади каскад из схемы, DELETE упадёт на FK — и это должно быть
      // видно как ошибка, а не как «доска не найдена».
      await expect(boardRepository.deleteAccessible(BOARD_ID, USER_ID)).rejects.toBe(
        foreignKeyFailure,
      );
    });
  });
});
