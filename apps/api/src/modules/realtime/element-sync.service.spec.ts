import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { ElementService } from '../element/element.service';
import type { ElementEntity } from '../element/entities/element.entity';
import { ElementSyncService } from './element-sync.service';
import { type AppSocket, MAX_BATCH_SIZE } from './realtime.types';

/**
 * Юнит ElementSyncService изолирует ровно то, что решает сам сервис: авторизацию по членству в
 * комнате (ДО обращения к персист-слою), перевод исхода ElementService в форму ack'а, broadcast
 * ПОЛНОГО элемента остальным членам комнаты без эха отправителю. Настоящего ElementService,
 * Prisma и socket.io здесь нет — только заглушка сокета (тот же приём, что в cursor.service.spec/
 * board-room.service.spec) и типизированный мок трёх методов ElementService, добавленных именно
 * под SLT-38 (`upsertEntity`/`patchVersioned`/`removeVersioned`). Их собственная корректность
 * (персист, атомарный conditional update) — забота element.service.spec/element.repository.spec.
 */

const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const OTHER_USER_ID = '019fa40d-9c2f-7b41-a8e5-3f1d0b7c22aa';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const BOARD_ROOM = `board:${BOARD_ID}`;
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
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

/** Полная форма PUT-тела + id — payload `element_create`. */
function createElementCreatePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: ELEMENT_ID,
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

/** Заглушка сокета: userId в data, rooms — комнаты досок, to/emit — то, чем сервис шлёт broadcast. */
function fakeSocket(rooms: string[] = [BOARD_ROOM]) {
  const toEmit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit: toEmit });
  const socket = {
    data: { userId: USER_ID, sessionGen: 0 },
    rooms: new Set(rooms),
    to,
  } as unknown as AppSocket;

  return { socket, to, toEmit };
}

/** Мок методов ElementService, которыми пользуется ElementSyncService, и только их (SLT-38/68). */
function createDependencies() {
  const upsertEntity = jest.fn() as jest.MockedFunction<ElementService['upsertEntity']>;
  const patchVersioned = jest.fn() as jest.MockedFunction<ElementService['patchVersioned']>;
  const removeVersioned = jest.fn() as jest.MockedFunction<ElementService['removeVersioned']>;
  const batchPatchVersioned = jest.fn() as jest.MockedFunction<
    ElementService['batchPatchVersioned']
  >;
  const batchRemoveVersioned = jest.fn() as jest.MockedFunction<
    ElementService['batchRemoveVersioned']
  >;

  const elementService = {
    upsertEntity,
    patchVersioned,
    removeVersioned,
    batchPatchVersioned,
    batchRemoveVersioned,
  } satisfies Pick<
    ElementService,
    | 'upsertEntity'
    | 'patchVersioned'
    | 'removeVersioned'
    | 'batchPatchVersioned'
    | 'batchRemoveVersioned'
  >;

  return {
    service: new ElementSyncService(elementService as unknown as ElementService),
    upsertEntity,
    patchVersioned,
    removeVersioned,
    batchPatchVersioned,
    batchRemoveVersioned,
  };
}

describe('ElementSyncService', () => {
  describe('handleCreate (element_create)', () => {
    it('персистит через ElementService и рассылает ПОЛНЫЙ элемент остальным членам комнаты, без эха себе', async () => {
      const { service, upsertEntity } = createDependencies();
      const { socket, to, toEmit } = fakeSocket();
      upsertEntity.mockResolvedValue({ element: createElementEntity(), isCreated: true });

      const result = await service.handleCreate(socket, createElementCreatePayload());

      expect(upsertEntity).toHaveBeenCalledWith(
        ELEMENT_ID,
        USER_ID,
        expect.objectContaining({ boardId: BOARD_ID, type: 'rect' }),
      );
      // Анти-эхо: relay строго через socket.to (не server.in) — отправитель не получает своё же событие.
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(toEmit).toHaveBeenCalledWith('element_created', {
        element: expect.objectContaining({ id: ELEMENT_ID, version: 1 }) as unknown,
        userId: USER_ID,
      });
      // Ack несёт version — то, чего нет в HTTP-ответе на PUT.
      expect(result).toEqual({
        ok: true,
        element: expect.objectContaining({ version: 1 }) as unknown,
      });
    });

    it('отклоняет мутацию в доску, где сокет не состоит в комнате — до похода в персист-слой', async () => {
      const { service, upsertEntity } = createDependencies();
      const { socket, to } = fakeSocket([]); // сокет ни в одной комнате доски

      const result = await service.handleCreate(socket, createElementCreatePayload());

      expect(result).toEqual({ ok: false, reason: 'access_denied' });
      expect(upsertEntity).not.toHaveBeenCalled();
      expect(to).not.toHaveBeenCalled();
    });

    it('отклоняет форму, не проходящую контракт элемента, не трогая персист-слой', async () => {
      const { service, upsertEntity } = createDependencies();
      const { socket } = fakeSocket();

      const result = await service.handleCreate(socket, createElementCreatePayload({ opacity: 5 }));

      expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
      expect(upsertEntity).not.toHaveBeenCalled();
    });

    it('переводит смену типа существующего элемента (409 SLT-20) в reject conflict', async () => {
      const { service, upsertEntity } = createDependencies();
      const { socket, to } = fakeSocket();
      upsertEntity.mockRejectedValue(
        new ConflictException('Тип существующего элемента изменить нельзя'),
      );

      const result = await service.handleCreate(socket, createElementCreatePayload());

      expect(result).toEqual({ ok: false, reason: 'conflict' });
      expect(to).not.toHaveBeenCalled();
    });

    it('переводит исчезнувшую в процессе доску (404 SLT-20) в reject not_found', async () => {
      const { service, upsertEntity } = createDependencies();
      const { socket } = fakeSocket();
      upsertEntity.mockRejectedValue(new NotFoundException('Доска не найдена'));

      const result = await service.handleCreate(socket, createElementCreatePayload());

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('переводит невалидную геометрию (400 SLT-20) в reject invalid_payload', async () => {
      const { service, upsertEntity } = createDependencies();
      const { socket } = fakeSocket();
      upsertEntity.mockRejectedValue(new BadRequestException(['data.points — обязательное поле']));

      const result = await service.handleCreate(socket, createElementCreatePayload());

      expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
    });

    it('переводит недостаток роли (403 SLT-41, viewer) в reject forbidden', async () => {
      const { service, upsertEntity } = createDependencies();
      const { socket, to } = fakeSocket();
      // Сокет В КОМНАТЕ (иначе отсеклось бы раньше, на isInBoardRoom, с access_denied) — но
      // роль viewer, и ElementService бросает forbiddenWrite().
      upsertEntity.mockRejectedValue(new ForbiddenException('Недостаточно прав для изменения'));

      const result = await service.handleCreate(socket, createElementCreatePayload());

      expect(result).toEqual({ ok: false, reason: 'forbidden' });
      expect(to).not.toHaveBeenCalled();
    });
  });

  describe('handleUpdate (element_update)', () => {
    it('применяет изменение при свежей version, инкрементит её и рассылает полный элемент', async () => {
      const { service, patchVersioned } = createDependencies();
      const { socket, to, toEmit } = fakeSocket();
      patchVersioned.mockResolvedValue({
        status: 'applied',
        element: createElementEntity({ x: 99, version: 2 }),
      });

      const result = await service.handleUpdate(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
        changes: { x: 99 },
      });

      expect(patchVersioned).toHaveBeenCalledWith(ELEMENT_ID, USER_ID, { x: 99 }, 1);
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(toEmit).toHaveBeenCalledWith('element_updated', {
        element: expect.objectContaining({ x: 99, version: 2 }) as unknown,
        userId: USER_ID,
      });
      expect(result).toEqual({
        ok: true,
        element: expect.objectContaining({ x: 99, version: 2 }) as unknown,
      });
    });

    it('на устаревшую version отклоняет, прикладывает АКТУАЛЬНЫЙ элемент и НЕ рассылает', async () => {
      const { service, patchVersioned } = createDependencies();
      const { socket, to, toEmit } = fakeSocket();
      const current = createElementEntity({ x: 5, version: 7 });
      patchVersioned.mockResolvedValue({ status: 'version_conflict', element: current });

      const result = await service.handleUpdate(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
        changes: { x: 99 },
      });

      expect(result).toEqual({
        ok: false,
        reason: 'version_conflict',
        element: expect.objectContaining({ x: 5, version: 7 }) as unknown,
      });
      // Отказ не рассылается — только применённая мутация меняет состояние остальных клиентов.
      expect(to).not.toHaveBeenCalled();
      expect(toEmit).not.toHaveBeenCalled();
    });

    it('отклоняет мутацию в доску, где сокет не в комнате — до похода в ElementService', async () => {
      const { service, patchVersioned } = createDependencies();
      const { socket } = fakeSocket([]);

      const result = await service.handleUpdate(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
        changes: { x: 99 },
      });

      expect(result).toEqual({ ok: false, reason: 'access_denied' });
      expect(patchVersioned).not.toHaveBeenCalled();
    });

    it('на элемент, отсутствующий под scope, отдаёт not_found', async () => {
      const { service, patchVersioned } = createDependencies();
      const { socket } = fakeSocket();
      patchVersioned.mockResolvedValue({ status: 'not_found' });

      const result = await service.handleUpdate(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
        changes: { x: 99 },
      });

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('на роль viewer отдаёт forbidden, не рассылая (SLT-41)', async () => {
      const { service, patchVersioned } = createDependencies();
      const { socket, to } = fakeSocket();
      patchVersioned.mockResolvedValue({ status: 'forbidden' });

      const result = await service.handleUpdate(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
        changes: { x: 99 },
      });

      expect(result).toEqual({ ok: false, reason: 'forbidden' });
      expect(to).not.toHaveBeenCalled();
    });

    it('отклоняет payload без обязательных полей адреса, не сходив в ElementService', async () => {
      const { service, patchVersioned } = createDependencies();
      const { socket } = fakeSocket();

      const result = await service.handleUpdate(socket, { id: ELEMENT_ID, changes: { x: 1 } });

      expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
      expect(patchVersioned).not.toHaveBeenCalled();
    });
  });

  describe('handleDelete (element_delete)', () => {
    it('мягко удаляет при свежей version и рассылает id + новую version + автора', async () => {
      const { service, removeVersioned } = createDependencies();
      const { socket, to, toEmit } = fakeSocket();
      removeVersioned.mockResolvedValue({ status: 'applied', id: ELEMENT_ID, version: 2 });

      const result = await service.handleDelete(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
      });

      expect(removeVersioned).toHaveBeenCalledWith(ELEMENT_ID, USER_ID, 1);
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(toEmit).toHaveBeenCalledWith('element_deleted', {
        id: ELEMENT_ID,
        version: 2,
        userId: USER_ID,
      });
      expect(result).toEqual({ ok: true, id: ELEMENT_ID, version: 2 });
    });

    it('на устаревшую version отклоняет, прикладывает актуальный элемент и НЕ рассылает', async () => {
      const { service, removeVersioned } = createDependencies();
      const { socket, to } = fakeSocket();
      removeVersioned.mockResolvedValue({
        status: 'version_conflict',
        element: createElementEntity({ version: 9 }),
      });

      const result = await service.handleDelete(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
      });

      expect(result).toEqual({
        ok: false,
        reason: 'version_conflict',
        element: expect.objectContaining({ version: 9 }) as unknown,
      });
      expect(to).not.toHaveBeenCalled();
    });

    it('отклоняет мутацию в доску, где сокет не в комнате — до похода в ElementService', async () => {
      const { service, removeVersioned } = createDependencies();
      const { socket } = fakeSocket([]);

      const result = await service.handleDelete(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
      });

      expect(result).toEqual({ ok: false, reason: 'access_denied' });
      expect(removeVersioned).not.toHaveBeenCalled();
    });

    it('на отсутствующий под scope элемент отдаёт not_found', async () => {
      const { service, removeVersioned } = createDependencies();
      const { socket } = fakeSocket();
      removeVersioned.mockResolvedValue({ status: 'not_found' });

      const result = await service.handleDelete(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
      });

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('на роль viewer отдаёт forbidden, не удаляя и не рассылая (SLT-41)', async () => {
      const { service, removeVersioned } = createDependencies();
      const { socket, to } = fakeSocket();
      removeVersioned.mockResolvedValue({ status: 'forbidden' });

      const result = await service.handleDelete(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
      });

      expect(result).toEqual({ ok: false, reason: 'forbidden' });
      expect(to).not.toHaveBeenCalled();
    });
  });

  describe('несколько сокетов одного участника', () => {
    it('не путает userId из socket.data с чужим — broadcast несёт userId ИНИЦИАТОРА', async () => {
      const { service, patchVersioned } = createDependencies();
      const { socket, toEmit } = fakeSocket();
      socket.data.userId = OTHER_USER_ID;
      patchVersioned.mockResolvedValue({
        status: 'applied',
        element: createElementEntity({ version: 2 }),
      });

      await service.handleUpdate(socket, {
        boardId: BOARD_ID,
        id: ELEMENT_ID,
        version: 1,
        changes: { x: 1 },
      });

      expect(patchVersioned).toHaveBeenCalledWith(ELEMENT_ID, OTHER_USER_ID, { x: 1 }, 1);
      expect(toEmit).toHaveBeenCalledWith(
        'element_updated',
        expect.objectContaining({ userId: OTHER_USER_ID }),
      );
    });
  });

  describe('адверсариальные payload — ack, а не необработанное исключение', () => {
    // Не «поле забыли» (это уже покрыто выше), а совсем не та ФОРМА целиком — то, что реально
    // приходит с недоверенного провода при баге клиента или чужом сокете: null/undefined,
    // примитив вместо объекта, массив. Каждый из них обязан долететь до безопасного
    // `safeParse`/`typeof`-раннего-выхода и вернуться ack-отказом, а не уронить промис
    // необработанным исключением — иначе один кривой клиент рвал бы обработчик события gateway.
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['число', 42],
      ['строка', 'garbage'],
      ['массив', [1, 2, 3]],
      ['пустой объект', {}],
    ])(
      'handleCreate не бросает на payload %s, отвечает invalid_payload',
      async (_label, payload) => {
        const { service, upsertEntity } = createDependencies();
        const { socket } = fakeSocket();

        await expect(service.handleCreate(socket, payload)).resolves.toEqual({
          ok: false,
          reason: 'invalid_payload',
        });
        expect(upsertEntity).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['число', 42],
      ['строка', 'garbage'],
      ['массив', [1, 2, 3]],
      ['пустой объект', {}],
    ])(
      'handleUpdate не бросает на payload %s, отвечает invalid_payload',
      async (_label, payload) => {
        const { service, patchVersioned } = createDependencies();
        const { socket } = fakeSocket();

        await expect(service.handleUpdate(socket, payload)).resolves.toEqual({
          ok: false,
          reason: 'invalid_payload',
        });
        expect(patchVersioned).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['число', 42],
      ['строка', 'garbage'],
      ['массив', [1, 2, 3]],
      ['пустой объект', {}],
    ])(
      'handleDelete не бросает на payload %s, отвечает invalid_payload',
      async (_label, payload) => {
        const { service, removeVersioned } = createDependencies();
        const { socket } = fakeSocket();

        await expect(service.handleDelete(socket, payload)).resolves.toEqual({
          ok: false,
          reason: 'invalid_payload',
        });
        expect(removeVersioned).not.toHaveBeenCalled();
      },
    );
  });

  describe('handleBatchUpdate (element_batch_update, SLT-68)', () => {
    const ELEMENT_ID_2 = '019fa5b1-0000-7000-8000-000000000003';

    it('поэлементный успех: применённые уходят в ОДНОМ broadcast, конфликтные — нет', async () => {
      const { service, batchPatchVersioned } = createDependencies();
      const { socket, to, toEmit } = fakeSocket();
      batchPatchVersioned.mockResolvedValue({
        applied: [createElementEntity({ x: 99, version: 2 })],
        conflicts: [
          {
            id: ELEMENT_ID_2,
            kind: 'version_conflict',
            element: createElementEntity({ id: ELEMENT_ID_2, version: 7 }),
          },
        ],
      });

      const result = await service.handleBatchUpdate(socket, {
        boardId: BOARD_ID,
        items: [
          { id: ELEMENT_ID, version: 1, changes: { x: 99 } },
          { id: ELEMENT_ID_2, version: 1, changes: { x: 1 } },
        ],
      });

      expect(batchPatchVersioned).toHaveBeenCalledWith(USER_ID, [
        { id: ELEMENT_ID, version: 1, changes: { x: 99 } },
        { id: ELEMENT_ID_2, version: 1, changes: { x: 1 } },
      ]);
      // ОДИН broadcast, не два — партнёр применяет пачку одним проходом.
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(toEmit).toHaveBeenCalledWith('element_batch_updated', {
        elements: [expect.objectContaining({ id: ELEMENT_ID, version: 2 }) as unknown],
        userId: USER_ID,
      });
      expect(result).toEqual({
        ok: true,
        applied: [expect.objectContaining({ id: ELEMENT_ID, version: 2 }) as unknown],
        conflicts: [
          {
            id: ELEMENT_ID_2,
            kind: 'version_conflict',
            element: expect.objectContaining({ id: ELEMENT_ID_2, version: 7 }) as unknown,
          },
        ],
      });
    });

    it('broadcast группируется по АВТОРИТЕТНОМУ boardId элемента, не по payload.boardId', async () => {
      const OTHER_BOARD_ID = '019fa5b1-0000-7000-8000-0000000000ff';
      const { service, batchPatchVersioned } = createDependencies();
      const { socket, to, toEmit } = fakeSocket();
      batchPatchVersioned.mockResolvedValue({
        applied: [
          createElementEntity({ id: ELEMENT_ID, boardId: BOARD_ID, version: 2 }),
          createElementEntity({ id: ELEMENT_ID_2, boardId: OTHER_BOARD_ID, version: 2 }),
        ],
        conflicts: [],
      });

      await service.handleBatchUpdate(socket, {
        boardId: BOARD_ID,
        items: [
          { id: ELEMENT_ID, version: 1, changes: { x: 1 } },
          { id: ELEMENT_ID_2, version: 1, changes: { x: 1 } },
        ],
      });

      expect(to).toHaveBeenCalledTimes(2);
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(to).toHaveBeenCalledWith(`board:${OTHER_BOARD_ID}`);
      expect(toEmit).toHaveBeenCalledTimes(2);
    });

    it('все элементы конфликтуют — ack ok, но broadcast не летит вовсе', async () => {
      const { service, batchPatchVersioned } = createDependencies();
      const { socket, to } = fakeSocket();
      batchPatchVersioned.mockResolvedValue({
        applied: [],
        conflicts: [{ id: ELEMENT_ID, kind: 'not_found' }],
      });

      const result = await service.handleBatchUpdate(socket, {
        boardId: BOARD_ID,
        items: [{ id: ELEMENT_ID, version: 1, changes: { x: 1 } }],
      });

      expect(to).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: true,
        applied: [],
        conflicts: [{ id: ELEMENT_ID, kind: 'not_found' }],
      });
    });

    it('отклоняет батч в доску, где сокет не в комнате — до похода в ElementService', async () => {
      const { service, batchPatchVersioned } = createDependencies();
      const { socket } = fakeSocket([]);

      const result = await service.handleBatchUpdate(socket, {
        boardId: BOARD_ID,
        items: [{ id: ELEMENT_ID, version: 1, changes: { x: 1 } }],
      });

      expect(result).toEqual({ ok: false, reason: 'access_denied' });
      expect(batchPatchVersioned).not.toHaveBeenCalled();
    });

    it('отклоняет пустой батч как invalid_payload, не сходив в ElementService', async () => {
      const { service, batchPatchVersioned } = createDependencies();
      const { socket } = fakeSocket();

      const result = await service.handleBatchUpdate(socket, { boardId: BOARD_ID, items: [] });

      expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
      expect(batchPatchVersioned).not.toHaveBeenCalled();
    });

    it('отклоняет батч сверх MAX_BATCH_SIZE как invalid_payload — серверный лимит, клиенту не доверяем (Р7)', async () => {
      const { service, batchPatchVersioned } = createDependencies();
      const { socket } = fakeSocket();
      const items = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, index) => ({
        id: `019fa5b1-0000-7000-9000-${String(index).padStart(12, '0')}`,
        version: 1,
        changes: { x: index },
      }));

      const result = await service.handleBatchUpdate(socket, { boardId: BOARD_ID, items });

      expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
      expect(batchPatchVersioned).not.toHaveBeenCalled();
    });
  });

  describe('handleBatchDelete (element_batch_delete, SLT-68)', () => {
    const ELEMENT_ID_2 = '019fa5b1-0000-7000-8000-000000000003';

    it('поэлементный успех: применённые уходят в ОДНОМ broadcast с id+version', async () => {
      const { service, batchRemoveVersioned } = createDependencies();
      const { socket, to, toEmit } = fakeSocket();
      batchRemoveVersioned.mockResolvedValue({
        applied: [{ id: ELEMENT_ID, version: 2 }],
        conflicts: [
          {
            id: ELEMENT_ID_2,
            kind: 'version_conflict',
            element: createElementEntity({ id: ELEMENT_ID_2, version: 9 }),
          },
        ],
      });

      const result = await service.handleBatchDelete(socket, {
        boardId: BOARD_ID,
        items: [
          { id: ELEMENT_ID, version: 1 },
          { id: ELEMENT_ID_2, version: 1 },
        ],
      });

      expect(batchRemoveVersioned).toHaveBeenCalledWith(USER_ID, [
        { id: ELEMENT_ID, version: 1 },
        { id: ELEMENT_ID_2, version: 1 },
      ]);
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(BOARD_ROOM);
      expect(toEmit).toHaveBeenCalledWith('element_batch_deleted', {
        deletions: [{ id: ELEMENT_ID, version: 2 }],
        userId: USER_ID,
      });
      expect(result).toEqual({
        ok: true,
        applied: [{ id: ELEMENT_ID, version: 2 }],
        conflicts: [
          {
            id: ELEMENT_ID_2,
            kind: 'version_conflict',
            element: expect.objectContaining({ id: ELEMENT_ID_2, version: 9 }) as unknown,
          },
        ],
      });
    });

    it('ничего не применилось — broadcast не летит', async () => {
      const { service, batchRemoveVersioned } = createDependencies();
      const { socket, to } = fakeSocket();
      batchRemoveVersioned.mockResolvedValue({
        applied: [],
        conflicts: [{ id: ELEMENT_ID, kind: 'forbidden' }],
      });

      await service.handleBatchDelete(socket, {
        boardId: BOARD_ID,
        items: [{ id: ELEMENT_ID, version: 1 }],
      });

      expect(to).not.toHaveBeenCalled();
    });

    it('отклоняет батч в доску, где сокет не в комнате — до похода в ElementService', async () => {
      const { service, batchRemoveVersioned } = createDependencies();
      const { socket } = fakeSocket([]);

      const result = await service.handleBatchDelete(socket, {
        boardId: BOARD_ID,
        items: [{ id: ELEMENT_ID, version: 1 }],
      });

      expect(result).toEqual({ ok: false, reason: 'access_denied' });
      expect(batchRemoveVersioned).not.toHaveBeenCalled();
    });

    it('отклоняет батч сверх MAX_BATCH_SIZE как invalid_payload', async () => {
      const { service, batchRemoveVersioned } = createDependencies();
      const { socket } = fakeSocket();
      const items = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, index) => ({
        id: `019fa5b1-0000-7000-9000-${String(index).padStart(12, '0')}`,
        version: 1,
      }));

      const result = await service.handleBatchDelete(socket, { boardId: BOARD_ID, items });

      expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
      expect(batchRemoveVersioned).not.toHaveBeenCalled();
    });
  });
});
