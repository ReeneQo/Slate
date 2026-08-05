import { ForbiddenException, HttpStatus, NotFoundException } from '@nestjs/common';

import type { ElementEntity } from '../element/entities/element.entity';
import type { BoardRepository } from './board.repository';
import { BoardService } from './board.service';
import type { CreateBoardDto } from './dto/create-board.dto';
import type { BoardEntity } from './entities/board.entity';

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
/** Владелец доски — кто-то другой. Сам сервис этого не знает: за него это знает `where` в репозитории. */
const OTHER_USER_ID = '019fa40d-9c2f-7b41-a8e5-3f1d0b7c22aa';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const ELEMENT_ID = '019fa5b1-0000-7000-8000-000000000002';
const TITLE = 'Sprint board';

const CREATED_AT = new Date('2026-07-29T10:00:00.000Z');
const UPDATED_AT = new Date('2026-07-30T12:00:00.000Z');

function createBoardEntity(overrides: Partial<BoardEntity> = {}): BoardEntity {
  return {
    id: BOARD_ID,
    title: TITLE,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function createElementEntity(overrides: Partial<ElementEntity> = {}): ElementEntity {
  return {
    id: ELEMENT_ID,
    boardId: BOARD_ID,
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
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

/**
 * Заглушка репозитория.
 *
 * Моки объявлены отдельными переменными и возвращаются наружу, а не достаются из объекта как
 * `boardRepository.create`: обращение к оторванному от объекта методу справедливо ловит
 * `@typescript-eslint/unbound-method`, и проще не создавать ситуацию, которую правило ловит.
 *
 * Каждая типизирована через `jest.MockedFunction<BoardRepository['метод']>` — разъедься
 * сигнатура репозитория с ожиданиями теста, упадёт typecheck, а не тест продолжит зелёным
 * проверять несуществующий контракт.
 *
 * `satisfies Record<keyof BoardRepository, unknown>` — страховка полноты: появится в репозитории
 * публичный метод, не подменённый здесь, и файл перестанет компилироваться. Иначе сервис в тесте
 * позвал бы `undefined` и упал с невнятным TypeError вместо внятной ошибки типов.
 */
function createDependencies() {
  const create = jest.fn() as jest.MockedFunction<BoardRepository['create']>;
  const findAllOwnedBy = jest.fn() as jest.MockedFunction<BoardRepository['findAllOwnedBy']>;
  const findAccessible = jest.fn() as jest.MockedFunction<BoardRepository['findAccessible']>;
  const existsAccessible = jest.fn() as jest.MockedFunction<BoardRepository['existsAccessible']>;
  const findElements = jest.fn() as jest.MockedFunction<BoardRepository['findElements']>;
  const updateAccessible = jest.fn() as jest.MockedFunction<BoardRepository['updateAccessible']>;
  const deleteAccessible = jest.fn() as jest.MockedFunction<BoardRepository['deleteAccessible']>;

  const boardRepository = {
    create,
    findAllOwnedBy,
    findAccessible,
    existsAccessible,
    findElements,
    updateAccessible,
    deleteAccessible,
  } satisfies Record<keyof BoardRepository, unknown>;

  return {
    boardService: new BoardService(boardRepository as unknown as BoardRepository),
    create,
    findAllOwnedBy,
    findAccessible,
    existsAccessible,
    findElements,
    updateAccessible,
    deleteAccessible,
  };
}

/** Ожидаемая форма ответа: ровно четыре поля, version среди них нет. */
const expectedBoardDto = {
  id: BOARD_ID,
  title: TITLE,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

describe('BoardService', () => {
  describe('create', () => {
    it('берёт ownerId из userId сессии, а не из тела запроса', async () => {
      const { boardService, create } = createDependencies();
      create.mockResolvedValue(createBoardEntity());

      // Клиент пытается назначить владельцем чужой аккаунт. В CreateBoardDto такого поля нет,
      // поэтому в реальном запросе его срежет ещё ValidationPipe({ whitelist: true }); здесь
      // подсовываем его насильно, чтобы зафиксировать: даже дойди оно до сервиса, владельцем
      // станет автор сессии.
      const dtoWithSmuggledOwner = { title: TITLE, ownerId: OTHER_USER_ID } as CreateBoardDto;

      await boardService.create(USER_ID, dtoWithSmuggledOwner);

      expect(create).toHaveBeenCalledWith({ ownerId: USER_ID, title: TITLE });
    });

    it('не подставляет свой дефолт названия — оставляет это БД', async () => {
      const { boardService, create } = createDependencies();
      create.mockResolvedValue(createBoardEntity({ title: 'Untitled' }));

      await boardService.create(USER_ID, {});

      // title: undefined ⇒ Prisma не включит колонку в INSERT и сработает @default("Untitled").
      // Подставь сервис строку сам — дефолт оказался бы в двух местах и однажды разошёлся.
      expect(create).toHaveBeenCalledWith({ ownerId: USER_ID, title: undefined });
    });

    it('возвращает BoardDto без version', async () => {
      const { boardService, create } = createDependencies();
      // Счётчика ревизий в сущности быть не должно (его нет в BOARD_SELECT), но если он туда
      // однажды попадёт — маппер обязан его отбросить. toEqual, а не toMatchObject: важно, что
      // ЛИШНИХ полей нет, toMatchObject пропустил бы утечку.
      create.mockResolvedValue({ ...createBoardEntity(), version: 7 } as BoardEntity);

      const result = await boardService.create(USER_ID, { title: TITLE });

      expect(result).toEqual(expectedBoardDto);
    });
  });

  describe('findAllOwned', () => {
    it('спрашивает только доски автора сессии', async () => {
      const { boardService, findAllOwnedBy } = createDependencies();
      findAllOwnedBy.mockResolvedValue([createBoardEntity()]);

      const result = await boardService.findAllOwned(USER_ID);

      // Единственный аргумент выборки — id из сессии: другого источника владения у списка нет.
      expect(findAllOwnedBy).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual([expectedBoardDto]);
    });

    it('на пустой список отдаёт пустой массив, а не ошибку', async () => {
      const { boardService, findAllOwnedBy } = createDependencies();
      findAllOwnedBy.mockResolvedValue([]);

      await expect(boardService.findAllOwned(USER_ID)).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    it('отдаёт метаданные владельцу', async () => {
      const { boardService, findAccessible } = createDependencies();
      findAccessible.mockResolvedValue(createBoardEntity());

      const result = await boardService.findOne(BOARD_ID, USER_ID);

      expect(findAccessible).toHaveBeenCalledWith(BOARD_ID, USER_ID);
      expect(result).toEqual(expectedBoardDto);
    });

    it('на чужую доску отвечает 404, а НЕ 403', async () => {
      const { boardService, findAccessible } = createDependencies();
      // Доска существует, но принадлежит OTHER_USER_ID: под access-scope строка не находится,
      // и для сервиса это ровно то же событие, что «доски нет».
      findAccessible.mockResolvedValue(null);

      const error = await boardService
        .findOne(BOARD_ID, USER_ID)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(NotFoundException);
      // Регрессия на утечку существования: 403 подтвердил бы, что доска есть, и перебором id
      // можно было бы отличить занятые идентификаторы от свободных.
      expect(error).not.toBeInstanceOf(ForbiddenException);
      expect((error as NotFoundException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    });

    it('на несуществующую доску отвечает тем же 404 и тем же текстом', async () => {
      const { boardService, findAccessible } = createDependencies();
      findAccessible.mockResolvedValue(null);

      // Сообщение обязано совпадать с ответом на чужую доску: разные тексты выдали бы ровно то,
      // что скрывает одинаковый статус.
      await expect(boardService.findOne(BOARD_ID, USER_ID)).rejects.toThrow('Доска не найдена');
    });
  });

  describe('assertAccessible', () => {
    it('молча пропускает владельца', async () => {
      const { boardService, existsAccessible } = createDependencies();
      existsAccessible.mockResolvedValue(true);

      await expect(boardService.assertAccessible(BOARD_ID, USER_ID)).resolves.toBeUndefined();
      expect(existsAccessible).toHaveBeenCalledWith(BOARD_ID, USER_ID);
    });

    it('на чужую доску отвечает тем же 404 и тем же текстом, что и остальные сценарии', async () => {
      const { boardService, existsAccessible } = createDependencies();
      existsAccessible.mockResolvedValue(false);

      // Вход для element-модуля (SLT-20): вставка элемента в чужую доску обязана выглядеть
      // ровно как обращение к несуществующей. Отдельная формулировка здесь выдала бы, что
      // доска существует, — то самое, что скрывает единый 404.
      const error = await boardService
        .assertAccessible(BOARD_ID, USER_ID)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
      expect((error as NotFoundException).message).toBe('Доска не найдена');
    });
  });

  describe('canAccess', () => {
    // Булев сосед assertAccessible для не-HTTP вызывающих (ws-комнаты, SLT-33): то же ядро
    // existsAccessible, но «да/нет» вместо исключения. Проверяем ровно проброс результата — без
    // NotFoundException, которому в реалтайме не место.
    it('возвращает true, когда доска доступна пользователю', async () => {
      const { boardService, existsAccessible } = createDependencies();
      existsAccessible.mockResolvedValue(true);

      await expect(boardService.canAccess(BOARD_ID, USER_ID)).resolves.toBe(true);
      expect(existsAccessible).toHaveBeenCalledWith(BOARD_ID, USER_ID);
    });

    it('возвращает false на чужую или несуществующую доску, не бросая', async () => {
      const { boardService, existsAccessible } = createDependencies();
      existsAccessible.mockResolvedValue(false);

      await expect(boardService.canAccess(BOARD_ID, USER_ID)).resolves.toBe(false);
    });
  });

  describe('findElements', () => {
    it('отдаёт элементы владельцу без version и deletedAt', async () => {
      const { boardService, findElements } = createDependencies();
      findElements.mockResolvedValue([createElementEntity()]);

      const result = await boardService.findElements(BOARD_ID, USER_ID);

      expect(findElements).toHaveBeenCalledWith(BOARD_ID, USER_ID);
      expect(result).toEqual([
        {
          id: ELEMENT_ID,
          boardId: BOARD_ID,
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
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
      ]);
    });

    it('различает пустую доску и недоступную: [] против 404', async () => {
      const { boardService, findElements } = createDependencies();
      findElements.mockResolvedValue([]);

      // Пустой холст — успешный ответ с пустым массивом. Отвечать на него 404 значило бы
      // выгонять пользователя с экрана только что созданной доски.
      await expect(boardService.findElements(BOARD_ID, USER_ID)).resolves.toEqual([]);

      findElements.mockResolvedValue(null);

      await expect(boardService.findElements(BOARD_ID, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('передаёт в репозиторий только title — version не его дело', async () => {
      const { boardService, updateAccessible } = createDependencies();
      updateAccessible.mockResolvedValue(createBoardEntity({ title: 'Renamed' }));

      const result = await boardService.update(BOARD_ID, USER_ID, { title: 'Renamed' });

      // Ни version, ни updatedAt сервис не передаёт: первым владеет репозиторий (одна точка
      // инкремента), вторым — Prisma через @updatedAt.
      expect(updateAccessible).toHaveBeenCalledWith(BOARD_ID, USER_ID, { title: 'Renamed' });
      expect(result).toEqual({ ...expectedBoardDto, title: 'Renamed' });
    });

    it('на чужую доску отвечает 404', async () => {
      const { boardService, updateAccessible } = createDependencies();
      updateAccessible.mockResolvedValue(null);

      await expect(boardService.update(BOARD_ID, USER_ID, { title: 'Renamed' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('удаляет доступную доску', async () => {
      const { boardService, deleteAccessible } = createDependencies();
      deleteAccessible.mockResolvedValue(true);

      await expect(boardService.remove(BOARD_ID, USER_ID)).resolves.toBeUndefined();
      expect(deleteAccessible).toHaveBeenCalledWith(BOARD_ID, USER_ID);
    });

    it('на чужую доску отвечает 404 и ничего не удаляет', async () => {
      const { boardService, deleteAccessible } = createDependencies();
      // false ⇒ под access-scope строки не нашлось, то есть DELETE никого не затронул.
      deleteAccessible.mockResolvedValue(false);

      await expect(boardService.remove(BOARD_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
