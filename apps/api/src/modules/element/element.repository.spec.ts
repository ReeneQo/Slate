import { Prisma } from '@slate/database';

import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ElementRepository, type ReplaceElementData } from './element.repository';
import { ELEMENT_SELECT } from './entities/element.entity';

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const ELEMENT_ID = '019fa5b1-0000-7000-8000-000000000002';

/**
 * Ожидаемая область видимости элемента, выписанная БУКВАЛЬНО.
 *
 * Как и в board.repository.spec, форма не берётся вызовом `accessibleElementScope`: тест,
 * повторяющий реализацию, остался бы зелёным при любой её правке — включая ту, что открывает
 * доступ к чужим доскам. Здесь важно зафиксировать именно вложенный фильтр по связи `board`:
 * это и есть переиспользование проверки доступа из SLT-19 (расширено SLT-41 до owner ∪
 * участник любой роли), и оно не должно исчезнуть незаметно.
 */
const ACCESS_SCOPED_WHERE = {
  id: ELEMENT_ID,
  board: { OR: [{ ownerId: USER_ID }, { members: { some: { userId: USER_ID } } }] },
};

/** То же самое плюс «только живой». Разница между этими двумя — весь soft delete модуля. */
const LIVE_ACCESS_SCOPED_WHERE = { ...ACCESS_SCOPED_WHERE, deletedAt: null };

type ElementFindFirst = (args: Prisma.ElementFindFirstArgs) => Promise<unknown>;
type ElementCreate = (args: Prisma.ElementCreateArgs) => Promise<unknown>;
type ElementUpdate = (args: Prisma.ElementUpdateArgs) => Promise<unknown>;

function createShape(): ReplaceElementData {
  return {
    type: 'rect',
    x: 10,
    y: 20,
    angle: 0,
    opacity: 1,
    stroke: '#1e1e1e',
    fill: null,
    strokeWidth: 2,
    seed: 42,
    order: 1,
    data: { width: 120, height: 80 },
  };
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, { code, clientVersion: 'test' });
}

/** Узкие сигнатуры вместо настоящих делегатов Prisma — по причине из board.repository.spec. */
function createDependencies() {
  const findFirst = jest.fn() as jest.MockedFunction<ElementFindFirst>;
  const create = jest.fn() as jest.MockedFunction<ElementCreate>;
  const update = jest.fn() as jest.MockedFunction<ElementUpdate>;

  const prisma = { element: { findFirst, create, update } } as unknown as PrismaService;

  return { elementRepository: new ElementRepository(prisma), findFirst, create, update };
}

describe('ElementRepository', () => {
  describe('create', () => {
    it('пишет клиентский id и не тянет из строки лишних полей', async () => {
      const { elementRepository, create } = createDependencies();
      create.mockResolvedValue({});

      await elementRepository.create({ id: ELEMENT_ID, boardId: BOARD_ID, ...createShape() });

      // id приходит из URL, а не генерится БД (@id без @default в схеме): холст рисует фигуру
      // до ответа сервера, поэтому идентификатор существует раньше строки.
      expect(create).toHaveBeenCalledWith({
        data: { id: ELEMENT_ID, boardId: BOARD_ID, ...createShape() },
        select: ELEMENT_SELECT,
      });
    });

    it('переводит занятый первичный ключ в доменный отказ, а не в 500', async () => {
      const { elementRepository, create } = createDependencies();
      create.mockRejectedValue(prismaError('P2002'));

      await expect(
        elementRepository.create({ id: ELEMENT_ID, boardId: BOARD_ID, ...createShape() }),
      ).resolves.toEqual({ status: 'id-taken' });
    });

    it('переводит упавший внешний ключ в «доски нет»', async () => {
      const { elementRepository, create } = createDependencies();
      create.mockRejectedValue(prismaError('P2003'));

      // Гонка: доску удалили между проверкой доступа и вставкой. Без этой ветки редкий, но
      // вполне реальный сценарий отдавал бы 500.
      await expect(
        elementRepository.create({ id: ELEMENT_ID, boardId: BOARD_ID, ...createShape() }),
      ).resolves.toEqual({ status: 'board-missing' });
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { elementRepository, create } = createDependencies();
      const connectionFailure = new Error('connection terminated');
      create.mockRejectedValue(connectionFailure);

      await expect(
        elementRepository.create({ id: ELEMENT_ID, boardId: BOARD_ID, ...createShape() }),
      ).rejects.toBe(connectionFailure);
    });
  });

  describe('findAccessible', () => {
    it('ищет только живой элемент и только на доступной доске', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue(null);

      await elementRepository.findAccessible(ELEMENT_ID, USER_ID);

      // Фильтр мягкого удаления стоит ЗДЕСЬ, в слое данных: сервис про deletedAt не знает и
      // потому не может его забыть.
      expect(findFirst).toHaveBeenCalledWith({
        where: LIVE_ACCESS_SCOPED_WHERE,
        select: ELEMENT_SELECT,
      });
    });
  });

  describe('getAccessLevel', () => {
    const SELECT_SHAPE = {
      where: LIVE_ACCESS_SCOPED_WHERE,
      select: {
        board: {
          select: {
            ownerId: true,
            members: { where: { userId: USER_ID }, select: { role: true } },
          },
        },
      },
    };

    it('спрашивает уровень доступа доски ЧЕРЕЗ живой элемент, одним запросом', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ board: { ownerId: USER_ID, members: [] } });

      await expect(elementRepository.getAccessLevel(ELEMENT_ID, USER_ID)).resolves.toBe('owner');

      // Живой фильтр в where, как у findAccessible: мягко удалённый элемент недоступен для
      // PATCH/DELETE, для которых и заводился этот метод.
      expect(findFirst).toHaveBeenCalledWith(SELECT_SHAPE);
    });

    it('участнику-editor отдаёт editor', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({
        board: { ownerId: 'someone-else', members: [{ role: 'editor' }] },
      });

      await expect(elementRepository.getAccessLevel(ELEMENT_ID, USER_ID)).resolves.toBe('editor');
    });

    it('участнику-viewer отдаёт viewer', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({
        board: { ownerId: 'someone-else', members: [{ role: 'viewer' }] },
      });

      await expect(elementRepository.getAccessLevel(ELEMENT_ID, USER_ID)).resolves.toBe('viewer');
    });

    it('на чужой, удалённый или несуществующий элемент отдаёт null', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue(null);

      await expect(elementRepository.getAccessLevel(ELEMENT_ID, USER_ID)).resolves.toBeNull();
    });
  });

  describe('findInvariantsIncludingDeleted', () => {
    it('видит мягко удалённую строку — иначе воскрешение невозможно', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ boardId: BOARD_ID, type: 'rect' });

      await expect(
        elementRepository.findInvariantsIncludingDeleted(ELEMENT_ID, USER_ID),
      ).resolves.toEqual({ boardId: BOARD_ID, type: 'rect' });

      // Единственный метод без `deletedAt: null`, и его отсутствие проверяется явно: вернись
      // фильтр сюда, PUT по удалённому id полез бы вставлять строку с занятым ключом, а
      // воскрешение перестало бы видеть тип удалённой фигуры.
      expect(findFirst).toHaveBeenCalledWith({
        where: ACCESS_SCOPED_WHERE,
        select: { boardId: true, type: true },
      });
    });

    it('читает оба инварианта ОДНИМ запросом', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ boardId: BOARD_ID, type: 'rect' });

      await elementRepository.findInvariantsIncludingDeleted(ELEMENT_ID, USER_ID);

      // boardId и type нужны upsert'у вместе и в один момент. Второй SELECT ради type был бы
      // не только лишним round-trip'ом, но и окном, в котором ответы разъедутся.
      expect(findFirst).toHaveBeenCalledTimes(1);
    });

    it('на чужой или отсутствующий элемент отдаёт null', async () => {
      const { elementRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue(null);

      // Элемент чужой доски не находится под scope — для вызывающего это то же самое, что
      // «строки нет». Различить их снаружи нечем, и в этом смысл.
      await expect(
        elementRepository.findInvariantsIncludingDeleted(ELEMENT_ID, USER_ID),
      ).resolves.toBeNull();
    });
  });

  describe('replaceAccessible', () => {
    it('снимает deletedAt и инкрементит version атомарно', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockResolvedValue({});

      await elementRepository.replaceAccessible(ELEMENT_ID, USER_ID, createShape());

      // `deletedAt: null` пишется всегда: воскрешение и обычная замена — одна операция, а не
      // ветка по состоянию. `{ increment: 1 }` — счёт на стороне БД, иначе два параллельных
      // запроса потеряли бы ревизию.
      expect(update).toHaveBeenCalledWith({
        where: ACCESS_SCOPED_WHERE,
        data: { ...createShape(), deletedAt: null, version: { increment: 1 } },
        select: ELEMENT_SELECT,
      });
    });

    it('не фильтрует удалённые — иначе воскрешать было бы нечего', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockResolvedValue({});

      await elementRepository.replaceAccessible(ELEMENT_ID, USER_ID, createShape());

      // Проверяется отсутствие ключа, а не его значение: `deletedAt: undefined` в условии
      // работал бы иначе, чем его отсутствие, и разницу стоит зафиксировать буквально.
      const [args] = update.mock.calls[0] ?? [];

      expect(args?.where).not.toHaveProperty('deletedAt');
    });

    it('превращает «строки под условие нет» в null', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockRejectedValue(prismaError('P2025'));

      await expect(
        elementRepository.replaceAccessible(ELEMENT_ID, USER_ID, createShape()),
      ).resolves.toBeNull();
    });
  });

  describe('patchAccessible', () => {
    it('меняет только присланное и инкрементит version', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockResolvedValue({});

      await elementRepository.patchAccessible(ELEMENT_ID, USER_ID, { x: 99 });

      // Ни id, ни boardId, ни type в data не попадают — их нет ни в PatchElementData, ни в DTO.
      // Живой фильтр в where: воскрешать через PATCH нельзя, для этого есть PUT.
      expect(update).toHaveBeenCalledWith({
        where: LIVE_ACCESS_SCOPED_WHERE,
        data: { x: 99, version: { increment: 1 } },
        select: ELEMENT_SELECT,
      });
    });

    it('не подставляет ключ data, когда геометрию не присылали', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockResolvedValue({});

      await elementRepository.patchAccessible(ELEMENT_ID, USER_ID, { fill: null });

      // `fill: null` — присланное значение (снять заливку), оно доезжает до БД. А ключа `data`
      // в UPDATE быть не должно вовсе, иначе jsonb перезаписался бы пустым.
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { fill: null, version: { increment: 1 } },
        }),
      );
    });

    it('на удалённый, чужой или отсутствующий элемент отдаёт null', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockRejectedValue(prismaError('P2025'));

      await expect(
        elementRepository.patchAccessible(ELEMENT_ID, USER_ID, { x: 1 }),
      ).resolves.toBeNull();
    });
  });

  describe('patchAccessibleVersioned', () => {
    it('вклеивает ожидаемую version в тот же where, что и scope с live-фильтром', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockResolvedValue({});

      await elementRepository.patchAccessibleVersioned(ELEMENT_ID, USER_ID, 3, { x: 99 });

      // Одна SQL-инструкция: version — часть WHERE того же UPDATE, а не отдельная проверка до
      // записи. Именно это делает conditional update атомарным (см. докстринг метода).
      expect(update).toHaveBeenCalledWith({
        where: { ...LIVE_ACCESS_SCOPED_WHERE, version: 3 },
        data: { x: 99, version: { increment: 1 } },
        select: ELEMENT_SELECT,
      });
    });

    it('на несовпавшую version (P2025) отдаёт null, как и на недоступный элемент', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockRejectedValue(prismaError('P2025'));

      // На уровне ЭТОГО запроса «версия устарела» и «элемента нет» неразличимы — оба случая
      // означают «0 строк под условие» в Postgres. Различает их ElementService отдельным чтением.
      await expect(
        elementRepository.patchAccessibleVersioned(ELEMENT_ID, USER_ID, 3, { x: 99 }),
      ).resolves.toBeNull();
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { elementRepository, update } = createDependencies();
      const connectionFailure = new Error('connection terminated');
      update.mockRejectedValue(connectionFailure);

      await expect(
        elementRepository.patchAccessibleVersioned(ELEMENT_ID, USER_ID, 3, { x: 99 }),
      ).rejects.toBe(connectionFailure);
    });

    it('конкурентность: из двух update с ОДНОЙ version применяется ровно один', async () => {
      // Живой фейк Prisma, а не два независимых мока с заготовленными ответами: только так
      // проверка «version в WHERE, а не read-then-write» имеет смысл. Фейк воспроизводит РОВНО
      // то, что делает Postgres одной SQL-инструкцией — сверяет version и пишет атомарно внутри
      // ОДНОГО вызова `update`, без промежуточного чтения. Будь репозиторий устроен иначе (сначала
      // прочитать version, сравнить в коде, потом писать) — окно между чтением и записью позволило
      // бы обеим сторонам увидеть одну и ту же исходную version и обеим «выиграть». Здесь этого
      // окна нет: сравнение и запись — один синхронный шаг фейка на каждый вызов.
      let stored = { id: ELEMENT_ID, version: 1, x: 0 };
      const racyUpdate = jest.fn((args: { where: { version: number }; data: { x?: number } }) => {
        if (args.where.version !== stored.version) {
          return Promise.reject(prismaError('P2025'));
        }

        stored = { ...stored, x: args.data.x ?? stored.x, version: stored.version + 1 };

        return Promise.resolve({ ...stored });
      });
      const prisma = { element: { update: racyUpdate } } as unknown as PrismaService;
      const elementRepository = new ElementRepository(prisma);

      const [first, second] = await Promise.all([
        elementRepository.patchAccessibleVersioned(ELEMENT_ID, USER_ID, 1, { x: 10 }),
        elementRepository.patchAccessibleVersioned(ELEMENT_ID, USER_ID, 1, { x: 20 }),
      ]);

      const applied = [first, second].filter((result) => result !== null);
      const rejected = [first, second].filter((result) => result === null);

      expect(applied).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(stored.version).toBe(2);
    });
  });

  describe('softDeleteAccessible', () => {
    it('ставит deletedAt вместо удаления строки', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockResolvedValue({ id: ELEMENT_ID });

      await expect(elementRepository.softDeleteAccessible(ELEMENT_ID, USER_ID)).resolves.toBe(true);

      // `delete` у Prisma здесь не вызывается вовсе: удаление обратимо (undo на клиенте,
      // отмена в реалтайме на этапе 3), поэтому строка остаётся.
      expect(update).toHaveBeenCalledWith({
        where: LIVE_ACCESS_SCOPED_WHERE,
        data: { deletedAt: expect.any(Date) as Date, version: { increment: 1 } },
        select: { id: true },
      });
    });

    it('повторное удаление ничего не переставляет — условие требует живой строки', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockRejectedValue(prismaError('P2025'));

      // Ретрай клиента не должен менять «когда удалили»: на это время обопрётся отмена
      // удаления в реалтайме.
      await expect(elementRepository.softDeleteAccessible(ELEMENT_ID, USER_ID)).resolves.toBe(
        false,
      );
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { elementRepository, update } = createDependencies();
      const connectionFailure = new Error('connection terminated');
      update.mockRejectedValue(connectionFailure);

      await expect(elementRepository.softDeleteAccessible(ELEMENT_ID, USER_ID)).rejects.toBe(
        connectionFailure,
      );
    });
  });

  describe('softDeleteAccessibleVersioned', () => {
    it('вклеивает ожидаемую version в where и отдаёт только id/version', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockResolvedValue({ id: ELEMENT_ID, version: 4 });

      await expect(
        elementRepository.softDeleteAccessibleVersioned(ELEMENT_ID, USER_ID, 3),
      ).resolves.toEqual({ id: ELEMENT_ID, version: 4 });

      expect(update).toHaveBeenCalledWith({
        where: { ...LIVE_ACCESS_SCOPED_WHERE, version: 3 },
        data: { deletedAt: expect.any(Date) as Date, version: { increment: 1 } },
        select: { id: true, version: true },
      });
    });

    it('на несовпавшую version отдаёт null — то же P2025, что и на недоступный элемент', async () => {
      const { elementRepository, update } = createDependencies();
      update.mockRejectedValue(prismaError('P2025'));

      await expect(
        elementRepository.softDeleteAccessibleVersioned(ELEMENT_ID, USER_ID, 3),
      ).resolves.toBeNull();
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { elementRepository, update } = createDependencies();
      const connectionFailure = new Error('connection terminated');
      update.mockRejectedValue(connectionFailure);

      await expect(
        elementRepository.softDeleteAccessibleVersioned(ELEMENT_ID, USER_ID, 3),
      ).rejects.toBe(connectionFailure);
    });
  });
});
