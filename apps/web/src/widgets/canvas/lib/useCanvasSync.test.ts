import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDocumentChangeListener, useDocumentStore } from '@/entities/canvas-element';
import type {
  AppSocket,
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

  it('сокета нет — сразу баннер, ничего не отправляет', async () => {
    const setHasSaveError = vi.fn();

    await sendMutation(null, { type: 'delete', deletions: [] }, boardId, setHasSaveError);

    expect(setHasSaveError).toHaveBeenCalledWith(true);
  });

  it('create: шлёт element_create с id в payload и без version, гасит баннер на успехе', async () => {
    const element = rect('el-1', 0);
    const ackResult: ElementCreateAckResult = { ok: true, element: { ...element, version: 5 } };
    const { socket, emit } = fakeSocket(ackResult);
    const setHasSaveError = vi.fn();

    await sendMutation(socket, { type: 'create', element }, boardId, setHasSaveError);

    expect(emit).toHaveBeenCalledWith(
      'element_create',
      expect.objectContaining({ id: 'el-1', boardId, type: 'rect', x: 10, y: 20 }),
      expect.any(Function),
    );
    const [, payload] = emit.mock.calls[0]!;
    expect('version' in (payload as object)).toBe(false);
    expect(setHasSaveError).toHaveBeenCalledWith(false);
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

  it('update: reject (version_conflict) — баннер, стор не трогаем', async () => {
    useDocumentStore.getState().applyRemoteCreate(rect('el-1', 3));
    const ackResult: ElementUpdateAckResult = {
      ok: false,
      reason: 'version_conflict',
      element: rect('el-1', 9),
    };
    const { socket } = fakeSocket(ackResult);
    const setHasSaveError = vi.fn();

    await sendMutation(
      socket,
      { type: 'update', id: 'el-1', patch: { x: 999 } },
      boardId,
      setHasSaveError,
    );

    expect(setHasSaveError).toHaveBeenCalledWith(true);
    // Локальная version НЕ подтягивается из reject — refetch-and-reapply вне границ SLT-39.
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

  it('delete: хотя бы один reject в пачке — баннер (Promise.all семантика SLT-27)', async () => {
    let call = 0;
    const emit = vi.fn(
      (_event: string, _payload: unknown, ack: (result: ElementDeleteAckResult) => void) => {
        call += 1;
        ack(call === 1 ? { ok: true, id: 'a', version: 1 } : { ok: false, reason: 'not_found' });
      },
    );
    const socket = { emit } as unknown as AppSocket;
    const setHasSaveError = vi.fn();

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
      setHasSaveError,
    );

    expect(setHasSaveError).toHaveBeenCalledWith(true);
  });
});
