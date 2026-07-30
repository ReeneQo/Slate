import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import type { BoardService } from '../board/board.service';
import type { UpsertElementDto } from './dto/upsert-element.dto';
import type { ElementRepository } from './element.repository';
import { ElementService } from './element.service';
import type { ElementEntity } from './entities/element.entity';

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const OTHER_BOARD_ID = '019fa5b1-0000-7000-8000-00000000000f';
const ELEMENT_ID = '019fa5b1-0000-7000-8000-000000000002';

const CREATED_AT = new Date('2026-07-29T10:00:00.000Z');
const UPDATED_AT = new Date('2026-07-30T12:00:00.000Z');

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

/** Полное тело PUT. `fill` намеренно не задан — проверяем, что сервис подставит явный null. */
function createUpsertDto(overrides: Partial<UpsertElementDto> = {}): UpsertElementDto {
  return {
    boardId: BOARD_ID,
    type: 'rect',
    x: 10,
    y: 20,
    angle: 0,
    opacity: 1,
    stroke: '#1e1e1e',
    strokeWidth: 2,
    seed: 42,
    order: 1,
    data: { width: 120, height: 80 },
    ...overrides,
  };
}

/** Форма фигуры, какой её должен увидеть слой данных: без id/boardId, с явным `fill: null`. */
const EXPECTED_SHAPE = {
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

/**
 * Что репозиторий отдаёт про УЖЕ СУЩЕСТВУЮЩИЙ элемент: его неизменяемые поля.
 *
 * Одним значением, а не двумя моками, потому что и читаются они одним запросом. Для теста это
 * важно как факт: `type` доступен upsert'у бесплатно — сравнение типов не добавляет обращений
 * к БД.
 */
const EXISTING_INVARIANTS = { boardId: BOARD_ID, type: 'rect' } as const;

const expectedElementDto = {
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
};

/**
 * Заглушки зависимостей — по образцу board.service.spec: моки объявлены переменными (иначе
 * `@typescript-eslint/unbound-method` справедливо ругается на оторванные от объекта методы) и
 * типизированы сигнатурами настоящих классов, чтобы расхождение ловил tsc, а не зелёный тест.
 *
 * `satisfies Record<keyof ElementRepository, unknown>` — страховка полноты репозитория.
 *
 * У BoardService подделан ОДИН метод, и `satisfies Pick<...>` фиксирует ровно это: element-модуль
 * пользуется единственным входом board-модуля. Появись в сервисе второй вызов к доске — тест
 * перестанет компилироваться, и это правильный сигнал: связей между модулями должно быть ровно
 * столько, сколько объявлено.
 */
function createDependencies() {
  const create = jest.fn() as jest.MockedFunction<ElementRepository['create']>;
  const findAccessible = jest.fn() as jest.MockedFunction<ElementRepository['findAccessible']>;
  const findInvariantsIncludingDeleted = jest.fn() as jest.MockedFunction<
    ElementRepository['findInvariantsIncludingDeleted']
  >;
  const replaceAccessible = jest.fn() as jest.MockedFunction<
    ElementRepository['replaceAccessible']
  >;
  const patchAccessible = jest.fn() as jest.MockedFunction<ElementRepository['patchAccessible']>;
  const softDeleteAccessible = jest.fn() as jest.MockedFunction<
    ElementRepository['softDeleteAccessible']
  >;

  const elementRepository = {
    create,
    findAccessible,
    findInvariantsIncludingDeleted,
    replaceAccessible,
    patchAccessible,
    softDeleteAccessible,
  } satisfies Record<keyof ElementRepository, unknown>;

  const assertAccessible = jest.fn() as jest.MockedFunction<BoardService['assertAccessible']>;
  assertAccessible.mockResolvedValue(undefined);

  const boardService = { assertAccessible } satisfies Pick<BoardService, 'assertAccessible'>;

  return {
    elementService: new ElementService(
      elementRepository as unknown as ElementRepository,
      boardService as unknown as BoardService,
    ),
    create,
    findAccessible,
    findInvariantsIncludingDeleted,
    replaceAccessible,
    patchAccessible,
    softDeleteAccessible,
    assertAccessible,
  };
}

describe('ElementService', () => {
  describe('upsert — создание', () => {
    it('создаёт элемент с id из URL, а не из тела', async () => {
      const { elementService, findInvariantsIncludingDeleted, create } = createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(null);
      create.mockResolvedValue({ status: 'created', element: createElementEntity() });

      const result = await elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto());

      // `fill` в теле не приходил — сервис обязан записать явный null: PUT заменяет фигуру
      // целиком, и «оставить прежнюю заливку» здесь означало бы неидемпотентный запрос.
      expect(create).toHaveBeenCalledWith({
        id: ELEMENT_ID,
        boardId: BOARD_ID,
        ...EXPECTED_SHAPE,
      });
      expect(result).toEqual({ element: expectedElementDto, isCreated: true });
    });

    it('перед вставкой проверяет доступ к доске из тела', async () => {
      const { elementService, findInvariantsIncludingDeleted, create, assertAccessible } =
        createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(null);
      // Доска чужая: board-модуль отвечает своим 404 — тем же, что и на несуществующую доску.
      assertAccessible.mockRejectedValue(new NotFoundException('Доска не найдена'));

      await expect(
        elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto()),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(assertAccessible).toHaveBeenCalledWith(BOARD_ID, USER_ID);
      // Главное: до вставки дело не дошло. Проверка не «где-то рядом», а строго перед записью.
      expect(create).not.toHaveBeenCalled();
    });

    it('на занятый чужим элементом id отвечает 409, не раскрывая владельца', async () => {
      const { elementService, findInvariantsIncludingDeleted, create } = createDependencies();
      // Строка есть, но вне области видимости: под scope не нашлась, значит для сервиса её нет.
      findInvariantsIncludingDeleted.mockResolvedValue(null);
      create.mockResolvedValue({ status: 'id-taken' });

      const error = await elementService
        .upsert(ELEMENT_ID, USER_ID, createUpsertDto())
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ConflictException);
      // Текст общий с «элемент на другой моей доске»: разные формулировки сообщали бы, чей
      // именно элемент занял идентификатор.
      expect((error as ConflictException).message).toBe(
        'Элемент с таким идентификатором принадлежит другой доске',
      );
    });

    it('на исчезнувшую в процессе доску отвечает 404 про доску, а не про элемент', async () => {
      const { elementService, findInvariantsIncludingDeleted, create } = createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(null);
      // Гонка: доску удалили между assertAccessible и INSERT — репозиторий поймал FK.
      create.mockResolvedValue({ status: 'board-missing' });

      await expect(elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto())).rejects.toThrow(
        'Доска не найдена',
      );
    });
  });

  describe('upsert — замена и воскрешение', () => {
    it('заменяет живой элемент целиком и отвечает 200-семантикой', async () => {
      const { elementService, findInvariantsIncludingDeleted, replaceAccessible, create } =
        createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);
      replaceAccessible.mockResolvedValue(createElementEntity({ x: 99 }));

      const result = await elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto({ x: 99 }));

      expect(replaceAccessible).toHaveBeenCalledWith(ELEMENT_ID, USER_ID, {
        ...EXPECTED_SHAPE,
        x: 99,
      });
      expect(create).not.toHaveBeenCalled();
      expect(result).toEqual({ element: { ...expectedElementDto, x: 99 }, isCreated: false });
    });

    it('воскрешает мягко удалённый тем же путём, что и заменяет живой', async () => {
      const { elementService, findInvariantsIncludingDeleted, replaceAccessible, create } =
        createDependencies();
      // Удалённый элемент находится (метод сознательно не фильтрует deletedAt), поэтому
      // сценарий — замена, а не вставка. Снятие deletedAt — дело репозитория.
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);
      replaceAccessible.mockResolvedValue(createElementEntity());

      const result = await elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto());

      expect(create).not.toHaveBeenCalled();
      expect(replaceAccessible).toHaveBeenCalledWith(ELEMENT_ID, USER_ID, EXPECTED_SHAPE);
      expect(result.isCreated).toBe(false);
    });

    it('не спрашивает доступ отдельно, когда элемент уже найден под scope', async () => {
      const {
        elementService,
        findInvariantsIncludingDeleted,
        replaceAccessible,
        assertAccessible,
      } = createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);
      replaceAccessible.mockResolvedValue(createElementEntity());

      await elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto());

      // Проверка доступа вклеена в where обоих запросов. Лишний вызов был бы не только
      // round-trip'ом, но и ложным ощущением, что защита именно в нём.
      expect(assertAccessible).not.toHaveBeenCalled();
    });

    it('отказывается переносить элемент на другую доску', async () => {
      const { elementService, findInvariantsIncludingDeleted, replaceAccessible } =
        createDependencies();
      // Элемент существует и доступен, но лежит на другой доске пользователя.
      findInvariantsIncludingDeleted.mockResolvedValue({ boardId: OTHER_BOARD_ID, type: 'rect' });

      await expect(
        elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto()),
      ).rejects.toBeInstanceOf(ConflictException);

      // Перемещение между досками — граница SLT-20. Молчаливая запись в присланную доску и
      // была бы этим перемещением.
      expect(replaceAccessible).not.toHaveBeenCalled();
    });

    it('на исчезнувший между чтением и записью элемент отвечает 404', async () => {
      const { elementService, findInvariantsIncludingDeleted, replaceAccessible } =
        createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);
      replaceAccessible.mockResolvedValue(null);

      await expect(elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto())).rejects.toThrow(
        'Элемент не найден',
      );
    });
  });

  describe('upsert — неизменяемый тип', () => {
    it('заменяет фигуру, когда тип совпал с хранимым', async () => {
      const { elementService, findInvariantsIncludingDeleted, replaceAccessible } =
        createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);
      replaceAccessible.mockResolvedValue(createElementEntity({ x: 99 }));

      const result = await elementService.upsert(ELEMENT_ID, USER_ID, createUpsertDto({ x: 99 }));

      // Тот же rect: замена проходит целиком, включая геометрию, — запрет касается только
      // природы фигуры, а не её содержимого.
      expect(replaceAccessible).toHaveBeenCalledWith(ELEMENT_ID, USER_ID, {
        ...EXPECTED_SHAPE,
        x: 99,
      });
      expect(result.isCreated).toBe(false);
    });

    it('отказывается менять тип существующей фигуры', async () => {
      const { elementService, findInvariantsIncludingDeleted, replaceAccessible } =
        createDependencies();
      // В БД лежит rect, клиент пытается положить под тот же id линию.
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);

      const error = await elementService
        .upsert(
          ELEMENT_ID,
          USER_ID,
          createUpsertDto({ type: 'line', data: { points: [0, 0, 10, 10] } }),
        )
        .catch((reason: unknown) => reason);

      // 409, а не 400: тело безупречно — `type` и `data` согласованы между собой. Не сходится
      // состояние, и повторять такой запрос бессмысленно.
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((error as ConflictException).message).toBe(
        'Тип существующего элемента изменить нельзя',
      );
      expect(replaceAccessible).not.toHaveBeenCalled();
    });

    it('при воскрешении сверяет тип с УДАЛЁННОЙ строкой', async () => {
      const { elementService, findInvariantsIncludingDeleted, replaceAccessible } =
        createDependencies();
      // Элемент мягко удалён, но его type никуда не делся — строка на месте, стоит лишь
      // deletedAt. Значит воскрешение подчиняется тому же инварианту, что и обычная замена:
      // undo возвращает ТУ ЖЕ фигуру, а не другую под её идентификатором.
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);

      await expect(
        elementService.upsert(
          ELEMENT_ID,
          USER_ID,
          createUpsertDto({ type: 'ellipse', data: { width: 10, height: 10 } }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(replaceAccessible).not.toHaveBeenCalled();
    });

    it('на новом id принимает любой валидный тип', async () => {
      const { elementService, findInvariantsIncludingDeleted, create } = createDependencies();
      // Строки нет — сравнивать не с чем, инвариант ещё только задаётся этим запросом.
      findInvariantsIncludingDeleted.mockResolvedValue(null);
      create.mockResolvedValue({
        status: 'created',
        element: createElementEntity({ type: 'line', data: { points: [0, 0, 10, 10] } }),
      });

      const result = await elementService.upsert(
        ELEMENT_ID,
        USER_ID,
        createUpsertDto({ type: 'line', data: { points: [0, 0, 10, 10] } }),
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'line', data: { points: [0, 0, 10, 10] } }),
      );
      expect(result.isCreated).toBe(true);
    });

    it('сверяет тип по уже прочитанной строке, без второго запроса', async () => {
      const { elementService, findInvariantsIncludingDeleted, findAccessible } =
        createDependencies();
      findInvariantsIncludingDeleted.mockResolvedValue(EXISTING_INVARIANTS);

      await elementService
        .upsert(
          ELEMENT_ID,
          USER_ID,
          createUpsertDto({ type: 'line', data: { points: [0, 0, 10, 10] } }),
        )
        .catch(() => undefined);

      // Запрет типа обязан быть бесплатным: upsert и так читает строку, чтобы решить
      // «создавать или заменять». Появись здесь второй SELECT — вырос бы самый горячий путь
      // autosave.
      expect(findInvariantsIncludingDeleted).toHaveBeenCalledTimes(1);
      expect(findAccessible).not.toHaveBeenCalled();
    });
  });

  describe('upsert — валидация геометрии', () => {
    it('отвергает data, не соответствующую type, не дойдя до БД', async () => {
      const { elementService, findInvariantsIncludingDeleted, create, replaceAccessible } =
        createDependencies();

      const error = await elementService
        .upsert(ELEMENT_ID, USER_ID, createUpsertDto({ data: { points: [0, 0, 10, 10] } }))
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      // Ни одного обращения к данным: невалидный запрос не должен доходить до базы.
      expect(findInvariantsIncludingDeleted).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(replaceAccessible).not.toHaveBeenCalled();
    });
  });

  describe('patch', () => {
    it('передаёт только присланные поля и не трогает version', async () => {
      const { elementService, patchAccessible, findAccessible } = createDependencies();
      patchAccessible.mockResolvedValue(createElementEntity({ x: 99 }));

      const result = await elementService.patch(ELEMENT_ID, USER_ID, { x: 99 });

      // Остальные поля — undefined: Prisma не включит их в UPDATE. id, boardId и type сюда не
      // попадают в принципе — их нет в PatchElementDto.
      expect(patchAccessible).toHaveBeenCalledWith(ELEMENT_ID, USER_ID, {
        x: 99,
        y: undefined,
        angle: undefined,
        opacity: undefined,
        stroke: undefined,
        fill: undefined,
        strokeWidth: undefined,
        order: undefined,
      });
      // Геометрию не присылали — лишнего чтения из БД нет: PATCH координат остаётся
      // однозапросным, а это самый частый запрос при перетаскивании.
      expect(findAccessible).not.toHaveBeenCalled();
      expect(result).toEqual({ ...expectedElementDto, x: 99 });
    });

    it('считает `fill: null` изменением, а не пустым телом', async () => {
      const { elementService, patchAccessible } = createDependencies();
      patchAccessible.mockResolvedValue(createElementEntity());

      await elementService.patch(ELEMENT_ID, USER_ID, { fill: null });

      // Снять заливку — законное изменение. От «поле не присылали» отличается именно значением.
      expect(patchAccessible).toHaveBeenCalledWith(
        ELEMENT_ID,
        USER_ID,
        expect.objectContaining({ fill: null }),
      );
    });

    it('проверяет присланную геометрию против типа ХРАНИМОГО элемента', async () => {
      const { elementService, findAccessible, patchAccessible } = createDependencies();
      findAccessible.mockResolvedValue(createElementEntity({ type: 'line' }));
      patchAccessible.mockResolvedValue(createElementEntity({ type: 'line' }));

      await elementService.patch(ELEMENT_ID, USER_ID, { data: { points: [0, 0, 10, 10] } });

      // type в PATCH не приходит, значит единственный источник истины о форме data — строка в БД.
      expect(findAccessible).toHaveBeenCalledWith(ELEMENT_ID, USER_ID);
      expect(patchAccessible).toHaveBeenCalledWith(
        ELEMENT_ID,
        USER_ID,
        expect.objectContaining({ data: { points: [0, 0, 10, 10] } }),
      );
    });

    it('отвергает геометрию чужого типа', async () => {
      const { elementService, findAccessible, patchAccessible } = createDependencies();
      findAccessible.mockResolvedValue(createElementEntity({ type: 'rect' }));

      // Клиент шлёт points прямоугольнику: без этой проверки в jsonb осталась бы фигура,
      // которую не сможет отрисовать никто.
      await expect(
        elementService.patch(ELEMENT_ID, USER_ID, { data: { points: [0, 0, 10, 10] } }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(patchAccessible).not.toHaveBeenCalled();
    });

    it('отвергает пустое тело, не сходив в БД', async () => {
      const { elementService, patchAccessible, findAccessible } = createDependencies();

      await expect(elementService.patch(ELEMENT_ID, USER_ID, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );

      // Пустой PATCH инкрементил бы version и трогал updatedAt, ничего не меняя, — тихо портил
      // бы данные вместо честного 400.
      expect(patchAccessible).not.toHaveBeenCalled();
      expect(findAccessible).not.toHaveBeenCalled();
    });

    it('на чужой, удалённый или отсутствующий элемент отвечает 404, а НЕ 403', async () => {
      const { elementService, patchAccessible } = createDependencies();
      patchAccessible.mockResolvedValue(null);

      const error = await elementService
        .patch(ELEMENT_ID, USER_ID, { x: 1 })
        .catch((reason: unknown) => reason);

      // Та же политика, что у доски в SLT-19: 403 подтвердил бы существование элемента, и
      // перебором id можно было бы отличать занятые идентификаторы от свободных.
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
      expect((error as NotFoundException).message).toBe('Элемент не найден');
    });
  });

  describe('remove', () => {
    it('мягко удаляет доступный элемент', async () => {
      const { elementService, softDeleteAccessible } = createDependencies();
      softDeleteAccessible.mockResolvedValue(true);

      await expect(elementService.remove(ELEMENT_ID, USER_ID)).resolves.toBeUndefined();
      expect(softDeleteAccessible).toHaveBeenCalledWith(ELEMENT_ID, USER_ID);
    });

    it('на чужой или уже удалённый элемент отвечает тем же 404', async () => {
      const { elementService, softDeleteAccessible } = createDependencies();
      softDeleteAccessible.mockResolvedValue(false);

      const error = await elementService
        .remove(ELEMENT_ID, USER_ID)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
      expect((error as NotFoundException).message).toBe('Элемент не найден');
    });
  });
});
