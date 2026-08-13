import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDocumentChangeListener, useDocumentStore } from './document.store';
import { createDraft, updateDraftGeometry } from './element';
import { beginTransaction, endTransaction, useHistoryStore } from './history.store';

/** Готовый к коммиту черновик прямоугольника. */
function rectDraft() {
  return updateDraftGeometry(createDraft('rect', { x: 100, y: 100 }), { x: 60, y: 140 });
}

/** Коммитит черновик и возвращает его id (последний в elementIds). */
function commit(): string {
  useDocumentStore.getState().commitElement(rectDraft());
  const id = useDocumentStore.getState().elementIds.at(-1);
  if (!id) throw new Error('commitElement не добавил элемент');
  return id;
}

describe('useHistoryStore', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useHistoryStore.getState().reset();
    setDocumentChangeListener(null);
  });

  describe('формирование инверсии', () => {
    it('commitElement пишет инверсию delete(id)', () => {
      const id = commit();

      const { past } = useHistoryStore.getState();
      expect(past).toHaveLength(1);
      expect(past[0]).toEqual({ operations: [{ kind: 'delete', ids: [id] }] });
    });

    it('updateElement пишет инверсию update(id, СТАРЫЕ значения затронутых полей)', () => {
      const id = commit();
      const before = useDocumentStore.getState().elements[id]!;
      useHistoryStore.getState().reset(); // инверсию create от commit не проверяем в этом тесте

      useDocumentStore.getState().updateElement(id, { x: 999, y: 500 });

      const { past } = useHistoryStore.getState();
      expect(past).toHaveLength(1);
      expect(past[0]).toEqual({
        operations: [{ kind: 'update', id, patch: { x: before.x, y: before.y } }],
      });
    });

    it('updateElement пишет инверсию только по полям из патча, не по всем полям элемента', () => {
      const id = commit();
      useHistoryStore.getState().reset();

      useDocumentStore.getState().updateElement(id, { x: 42 });

      const op = useHistoryStore.getState().past[0]!.operations[0]!;
      expect(op).toEqual({ kind: 'update', id, patch: { x: 60 } });
    });

    it('deleteElements пишет инверсию create(ПОЛНЫЕ снятые элементы)', () => {
      const id = commit();
      const element = useDocumentStore.getState().elements[id]!;
      useHistoryStore.getState().reset();

      useDocumentStore.getState().deleteElements([id]);

      const { past } = useHistoryStore.getState();
      expect(past).toHaveLength(1);
      expect(past[0]).toEqual({ operations: [{ kind: 'create', elements: [element] }] });
    });

    it('restoreElements (redo create / undo delete) пишет инверсию delete(ids)', () => {
      const id = commit();
      const element = useDocumentStore.getState().elements[id]!;
      useDocumentStore.getState().deleteElements([id]);
      useHistoryStore.getState().reset();

      useDocumentStore.getState().restoreElements([element]);

      expect(useHistoryStore.getState().past).toEqual([
        { operations: [{ kind: 'delete', ids: [id] }] },
      ]);
    });
  });

  describe('undo/redo — базовый цикл', () => {
    it('undo применяет инверсию: created-элемент исчезает', () => {
      const id = commit();

      useHistoryStore.getState().undo();

      expect(useDocumentStore.getState().elements[id]).toBeUndefined();
    });

    it('redo повторяет отменённое действие', () => {
      const id = commit();
      useHistoryStore.getState().undo();

      useHistoryStore.getState().redo();

      expect(useDocumentStore.getState().elements[id]?.id).toBe(id);
    });

    it('undo без истории — no-op, не бросает', () => {
      expect(() => useHistoryStore.getState().undo()).not.toThrow();
      expect(useHistoryStore.getState().past).toEqual([]);
    });

    it('redo без будущего — no-op, не бросает', () => {
      expect(() => useHistoryStore.getState().redo()).not.toThrow();
    });

    it('undo update возвращает прежнее значение поля', () => {
      const id = commit();
      useDocumentStore.getState().updateElement(id, { x: 999 });

      useHistoryStore.getState().undo();

      expect(useDocumentStore.getState().elements[id]?.x).toBe(60);
    });

    it('undo delete пересоздаёт элемент под тем же id', () => {
      const id = commit();
      useDocumentStore.getState().deleteElements([id]);

      useHistoryStore.getState().undo();

      expect(useDocumentStore.getState().elements[id]?.id).toBe(id);
    });

    it('undo применяет инверсию через мутаторы document-стора — уезжает в WS обычным путём', () => {
      const listener = vi.fn();
      const id = commit();
      setDocumentChangeListener(listener);

      useHistoryStore.getState().undo();

      // commitElement создал элемент ДО того, как слушатель был подписан — на undo слушатель уже
      // висит и обязан увидеть инверсию (delete) как обычную мутацию (SLT-65 Р3).
      expect(listener).toHaveBeenCalledWith({
        type: 'delete',
        deletions: [{ id, version: 0 }],
      });
    });
  });

  describe('past/future — стеки', () => {
    it('новое действие ПОСЛЕ undo чистит future (redo невозможен)', () => {
      const first = commit();
      useHistoryStore.getState().undo();
      expect(useHistoryStore.getState().future).toHaveLength(1);

      commit(); // новое обычное действие

      expect(useHistoryStore.getState().future).toEqual([]);
      // И redo больше не восстанавливает отменённый first.
      useHistoryStore.getState().redo();
      expect(useDocumentStore.getState().elements[first]).toBeUndefined();
    });

    it('применение undo НЕ пишет новую запись в past (не зацикливается)', () => {
      commit();
      const pastLengthBeforeUndo = useHistoryStore.getState().past.length;

      useHistoryStore.getState().undo();

      expect(useHistoryStore.getState().past).toHaveLength(pastLengthBeforeUndo - 1);
    });

    it('применение redo НЕ пишет новую запись в future (не зацикливается)', () => {
      commit();
      useHistoryStore.getState().undo();
      const futureLengthBeforeRedo = useHistoryStore.getState().future.length;

      useHistoryStore.getState().redo();

      expect(useHistoryStore.getState().future).toHaveLength(futureLengthBeforeRedo - 1);
    });
  });

  describe('транзакции (group-drag / multi-resize)', () => {
    it('N операций между begin/endTransaction — один шаг past, один undo откатывает все разом', () => {
      const first = commit();
      const second = commit();
      useHistoryStore.getState().reset();

      beginTransaction();
      useDocumentStore.getState().updateElement(first, { x: 1 });
      useDocumentStore.getState().updateElement(second, { x: 2 });
      endTransaction();

      const { past } = useHistoryStore.getState();
      expect(past).toHaveLength(1);
      expect(past[0]!.operations).toHaveLength(2);

      useHistoryStore.getState().undo();
      expect(useDocumentStore.getState().elements[first]?.x).toBe(60);
      expect(useDocumentStore.getState().elements[second]?.x).toBe(60);
    });

    it('endTransaction без операций ничего не фиксирует', () => {
      beginTransaction();
      endTransaction();

      expect(useHistoryStore.getState().past).toEqual([]);
    });
  });

  describe('устойчивость к отсутствию цели (Р4)', () => {
    it('undo update отсутствующего элемента — no-op, не бросает', () => {
      const id = commit();
      useDocumentStore.getState().updateElement(id, { x: 999 });
      // Элемент исчез между записью и undo (напр. чужой remote-delete) — история его не видит,
      // топ past остаётся инверсией update.
      useDocumentStore.getState().applyRemoteDelete(id);

      expect(() => useHistoryStore.getState().undo()).not.toThrow();
      expect(useDocumentStore.getState().elements[id]).toBeUndefined();
    });
  });

  describe('чужое (remote) не пишется в историю', () => {
    it('applyRemoteCreate/Update/Delete не создают запись в past', () => {
      useDocumentStore.getState().applyRemoteCreate({
        id: 'remote-1',
        type: 'rect',
        x: 0,
        y: 0,
        angle: 0,
        opacity: 1,
        stroke: '#000',
        fill: null,
        strokeWidth: 2,
        seed: 1,
        order: 0,
        version: 0,
        data: { width: 10, height: 10 },
      });
      useDocumentStore.getState().applyRemoteDelete('remote-1');

      expect(useHistoryStore.getState().past).toEqual([]);
    });
  });
});
