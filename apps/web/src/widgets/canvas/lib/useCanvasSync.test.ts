import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDocumentChangeListener, useDocumentStore } from '@/entities/canvas-element';
import type {
  AppSocket,
  ElementBatchDeleteAckResult,
  ElementBatchUpdateAckResult,
  ElementCreateAckResult,
  ElementDeleteAckResult,
  ElementUpdateAckResult,
} from '@/features/realtime-presence';

import { sendMutation } from './useCanvasSync';

const boardId = '018f1a2b-3c4d-7e6f-8a9b-0c1d2e3f4a5b';

function rect(id: string, version: number) {
  return {
    id,
    type: 'rect' as const,
    x: 10,
    y: 20,
    angle: 0,
    opacity: 1,
    stroke: '#272d36',
    fill: null,
    strokeWidth: 2,
    seed: 1,
    order: 0,
    version,
    data: { width: 40, height: 40 },
  };
}

/** Фейковый socket: emit синхронно зовёт ack с заранее заданным результатом, не касаясь сети. */
function fakeSocket(ackResult: unknown) {
  const emit = vi.fn((_event: string, _payload: unknown, ack: (result: unknown) => void) => {
    ack(ackResult);
  });
  return { socket: { emit } as unknown as AppSocket, emit };
}

describe('sendMutation', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  afterEach(() => {
    setDocumentChangeListener(null);
  });

  it('сокета нет — сразу network-баннер, ничего не отправляет', async () => {
    const setSaveError = vi.fn();

    await sendMutation(null, { type: 'delete', deletions: [] }, boardId, setSaveError);

    expect(setSaveError).toHaveBeenCalledWith('network');
  });

  it('create: шлёт element_create с id в payload и без version, гасит баннер на успехе', async () => {
    const element = rect('el-1', 0);
    const ackResult: ElementCreateAckResult = { ok: true, element: { ...element, version: 5 } };
    const { socket, emit } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(socket, { type: 'create', element }, boardId, setSaveError);

    expect(emit).toHaveBeenCalledWith(
      'element_create',
      expect.objectContaining({ id: 'el-1', boardId, type: 'rect', x: 10, y: 20 }),
      expect.any(Function),
    );
    const [, payload] = emit.mock.calls[0]!;
    expect('version' in (payload as object)).toBe(false);
    expect(setSaveError).toHaveBeenCalledWith(null);
  });

  it('create: applied-ack тихо синхронизирует version в сторе (без нотификации autosave-слушателя)', async () => {
    const element = rect('el-1', 0);
    useDocumentStore.getState().applyRemoteCreate(element); // элемент уже в сторе (как после commit)
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    const ackResult: ElementCreateAckResult = { ok: true, element: { ...element, version: 5 } };
    const { socket } = fakeSocket(ackResult);

    await sendMutation(socket, { type: 'create', element }, boardId, vi.fn());

    expect(useDocumentStore.getState().elements['el-1']?.version).toBe(5);
    expect(listener).not.toHaveBeenCalled();
  });

  it('create: reject "conflict" (id занят) — network-баннер, version_conflict у create невозможен', async () => {
    const element = rect('el-1', 0);
    const ackResult: ElementCreateAckResult = { ok: false, reason: 'conflict' };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(socket, { type: 'create', element }, boardId, setSaveError);

    expect(setSaveError).toHaveBeenCalledWith('network');
  });

  it('update: шлёт element_update с boardId + текущей version элемента из стора + changes', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('el-1', 3));
    const ackResult: ElementUpdateAckResult = { ok: true, element: rect('el-1', 4) };
    const { socket, emit } = fakeSocket(ackResult);

    await sendMutation(socket, { type: 'update', id: 'el-1', patch: { x: 999 } }, boardId, vi.fn());

    expect(emit).toHaveBeenCalledWith(
      'element_update',
      { boardId, id: 'el-1', version: 3, changes: { x: 999 } },
      expect.any(Function),
    );
    expect(useDocumentStore.getState().elements['el-1']?.version).toBe(4);
  });

  it('update: reject version_conflict — применяет актуальный серверный элемент (last-write-wins) и conflict-баннер', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('el-1', 3));
    const serverElement = { ...rect('el-1', 9), x: 42 };
    const ackResult: ElementUpdateAckResult = {
      ok: false,
      reason: 'version_conflict',
      element: serverElement,
    };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      { type: 'update', id: 'el-1', patch: { x: 999 } },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('conflict');
    // Своя правка (x: 999) отброшена — стор несёт серверную (last-write-wins, НЕ reapply-догонку).
    expect(useDocumentStore.getState().elements['el-1']).toEqual(serverElement);
  });

  it('update: version_conflict применяется через remote-путь — не будит autosave-слушателя (анти-петля)', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('el-1', 3));
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    const ackResult: ElementUpdateAckResult = {
      ok: false,
      reason: 'version_conflict',
      element: rect('el-1', 9),
    };
    const { socket } = fakeSocket(ackResult);

    await sendMutation(socket, { type: 'update', id: 'el-1', patch: { x: 999 } }, boardId, vi.fn());

    expect(listener).not.toHaveBeenCalled();
  });

  it('update: reject "forbidden" (SLT-41 viewer) — forbidden-баннер, стор не трогаем (не incident отдаёт элемент)', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('el-1', 3));
    const ackResult: ElementUpdateAckResult = { ok: false, reason: 'forbidden' };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      { type: 'update', id: 'el-1', patch: { x: 999 } },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('forbidden');
    expect(useDocumentStore.getState().elements['el-1']?.version).toBe(3);
  });

  it('update: reject прочей причины (not_found) — network-баннер, стор не трогаем', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('el-1', 3));
    const ackResult: ElementUpdateAckResult = { ok: false, reason: 'not_found' };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      { type: 'update', id: 'el-1', patch: { x: 999 } },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('network');
    expect(useDocumentStore.getState().elements['el-1']?.version).toBe(3);
  });

  it('delete: шлёт по одному element_delete на id, version — из самого change (снята до удаления)', async () => {
    const ackResult: ElementDeleteAckResult = { ok: true, id: 'el-1', version: 4 };
    const { socket, emit } = fakeSocket(ackResult);

    await sendMutation(
      socket,
      { type: 'delete', deletions: [{ id: 'el-1', version: 3 }] },
      boardId,
      vi.fn(),
    );

    expect(emit).toHaveBeenCalledWith(
      'element_delete',
      { boardId, id: 'el-1', version: 3 },
      expect.any(Function),
    );
  });

  it('delete: reject version_conflict — сервер говорит «элемент всё ещё жив», клиент возвращает его в стор', async () => {
    // Элемент уже вычищен из стора оптимистично (deleteElements — до того, как асинхронный
    // emit долетел до ack), ровно как в реальном потоке document.store → sendMutation.
    const serverElement = rect('el-1', 5);
    const ackResult: ElementDeleteAckResult = {
      ok: false,
      reason: 'version_conflict',
      element: serverElement,
    };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      { type: 'delete', deletions: [{ id: 'el-1', version: 3 }] },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('conflict');
    expect(useDocumentStore.getState().elements['el-1']).toEqual(serverElement);
  });

  it('delete: >1 элемент — ОДИН element_batch_delete, а не N element_delete (SLT-68)', async () => {
    const ackResult: ElementBatchDeleteAckResult = {
      ok: true,
      applied: [
        { id: 'a', version: 1 },
        { id: 'b', version: 1 },
      ],
      conflicts: [],
    };
    const { socket, emit } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      {
        type: 'delete',
        deletions: [
          { id: 'a', version: 0 },
          { id: 'b', version: 0 },
        ],
      },
      boardId,
      setSaveError,
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'element_batch_delete',
      {
        boardId,
        items: [
          { id: 'a', version: 0 },
          { id: 'b', version: 0 },
        ],
      },
      expect.any(Function),
    );
    expect(setSaveError).toHaveBeenCalledWith(null);
  });

  it('delete: хотя бы один conflict в батче — баннер, применённые элементы НЕ откатываются (поэлементный успех)', async () => {
    const ackResult: ElementBatchDeleteAckResult = {
      ok: true,
      applied: [{ id: 'a', version: 1 }],
      conflicts: [{ id: 'b', kind: 'not_found' }],
    };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      {
        type: 'delete',
        deletions: [
          { id: 'a', version: 0 },
          { id: 'b', version: 0 },
        ],
      },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('network');
  });

  it('delete: батч с конфликтом И not_found — сводный баннер приоритизирует conflict (несёт действие), возвращает серверный элемент в стор', async () => {
    const serverElement = rect('b', 7);
    const ackResult: ElementBatchDeleteAckResult = {
      ok: true,
      applied: [],
      conflicts: [
        { id: 'a', kind: 'not_found' },
        { id: 'b', kind: 'version_conflict', element: serverElement },
      ],
    };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      {
        type: 'delete',
        deletions: [
          { id: 'a', version: 0 },
          { id: 'b', version: 6 },
        ],
      },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('conflict');
    expect(useDocumentStore.getState().elements.b).toEqual(serverElement);
  });

  it('delete: батч с forbidden И конфликтом — сводный баннер приоритизирует forbidden (объясняет остальное, SLT-43)', async () => {
    const serverElement = rect('b', 7);
    const ackResult: ElementBatchDeleteAckResult = {
      ok: true,
      applied: [],
      conflicts: [
        { id: 'b', kind: 'version_conflict', element: serverElement },
        { id: 'c', kind: 'forbidden' },
      ],
    };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      {
        type: 'delete',
        deletions: [
          { id: 'b', version: 6 },
          { id: 'c', version: 0 },
        ],
      },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('forbidden');
  });

  it('delete: батч-уровневый reject (access_denied/invalid_payload) — сетевой баннер, никакой стор не трогаем', async () => {
    const ackResult: ElementBatchDeleteAckResult = { ok: false, reason: 'access_denied' };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      {
        type: 'delete',
        deletions: [
          { id: 'a', version: 0 },
          { id: 'b', version: 0 },
        ],
      },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('network');
  });
});

describe('sendMutation — batch_update (group-drag/multi-resize, SLT-68)', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  afterEach(() => {
    setDocumentChangeListener(null);
  });

  it('шлёт ОДИН element_batch_update с version каждого элемента из стора, гасит баннер на полном успехе', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('a', 3));
    useDocumentStore.getState().applyRemoteCreate(rect('b', 5));
    const ackResult: ElementBatchUpdateAckResult = {
      ok: true,
      applied: [rect('a', 4), rect('b', 6)],
      conflicts: [],
    };
    const { socket, emit } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      {
        type: 'batch_update',
        updates: [
          { id: 'a', patch: { x: 1 } },
          { id: 'b', patch: { y: 2 } },
        ],
      },
      boardId,
      setSaveError,
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'element_batch_update',
      {
        boardId,
        items: [
          { id: 'a', version: 3, changes: { x: 1 } },
          { id: 'b', version: 5, changes: { y: 2 } },
        ],
      },
      expect.any(Function),
    );
    expect(useDocumentStore.getState().elements.a?.version).toBe(4);
    expect(useDocumentStore.getState().elements.b?.version).toBe(6);
    expect(setSaveError).toHaveBeenCalledWith(null);
  });

  it('applied синхронизирует version каждого элемента, conflicts (version_conflict) применяет актуальный через remote-путь — конфликт одного не откатывает применённые', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('a', 3));
    useDocumentStore.getState().applyRemoteCreate(rect('b', 5));
    const serverB = { ...rect('b', 9), x: 42 };
    const ackResult: ElementBatchUpdateAckResult = {
      ok: true,
      applied: [rect('a', 4)],
      conflicts: [{ id: 'b', kind: 'version_conflict', element: serverB }],
    };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      {
        type: 'batch_update',
        updates: [
          { id: 'a', patch: { x: 1 } },
          { id: 'b', patch: { x: 999 } },
        ],
      },
      boardId,
      setSaveError,
    );

    expect(useDocumentStore.getState().elements.a?.version).toBe(4);
    // Своя правка на 'b' отброшена — стор несёт серверную (LWW), как у одиночного version_conflict.
    expect(useDocumentStore.getState().elements.b).toEqual(serverB);
    expect(setSaveError).toHaveBeenCalledWith('conflict');
  });

  it('conflicts прочих причин (not_found/forbidden) — приоритизированный баннер, без element в сторе', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('a', 3));
    const ackResult: ElementBatchUpdateAckResult = {
      ok: true,
      applied: [],
      conflicts: [{ id: 'a', kind: 'forbidden' }],
    };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      { type: 'batch_update', updates: [{ id: 'a', patch: { x: 1 } }] },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('forbidden');
    expect(useDocumentStore.getState().elements.a?.version).toBe(3);
  });

  it('батч-уровневый reject (access_denied/invalid_payload) — сетевой баннер', async () => {
    const ackResult: ElementBatchUpdateAckResult = { ok: false, reason: 'invalid_payload' };
    const { socket } = fakeSocket(ackResult);
    const setSaveError = vi.fn();

    await sendMutation(
      socket,
      { type: 'batch_update', updates: [{ id: 'a', patch: { x: 1 } }] },
      boardId,
      setSaveError,
    );

    expect(setSaveError).toHaveBeenCalledWith('network');
  });
});
