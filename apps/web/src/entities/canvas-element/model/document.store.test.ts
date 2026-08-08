import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DocumentChange, setDocumentChangeListener, useDocumentStore } from './document.store';
import { createDraft, updateDraftGeometry } from './element';
import type { CanvasElement } from './types';

/** Готовый к коммиту черновик прямоугольника. */
function rectDraft() {
  return updateDraftGeometry(createDraft('rect', { x: 100, y: 100 }), {
    x: 60,
    y: 140,
  });
}

/** Коммитит черновик и возвращает его id (последний в elementIds). */
function commit(): string {
  useDocumentStore.getState().commitElement(rectDraft());
  const { elementIds } = useDocumentStore.getState();
  const id = elementIds.at(-1);
  if (!id) throw new Error('commitElement не добавил элемент');
  return id;
}

describe('useDocumentStore', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  afterEach(() => {
    setDocumentChangeListener(null);
  });

  it('commitElement добавляет элемент в elements и elementIds синхронно', () => {
    const id = commit();

    const { elements, elementIds } = useDocumentStore.getState();
    expect(elementIds).toHaveLength(1);
    expect(Object.keys(elements)).toHaveLength(1);
    expect(elements[id]?.id).toBe(id);
  });

  it('commitElement нормализует размеры и присваивает id', () => {
    const id = commit();

    const element = useDocumentStore.getState().elements[id];
    expect(element).toMatchObject({ x: 60, y: 100, data: { width: 40, height: 40 } });
    expect(element?.id).toBeTruthy();
  });

  it('commitElement присваивает id формата uuid v7 и растущий order', () => {
    const first = commit();
    const second = commit();

    const { elements } = useDocumentStore.getState();
    // uuid v7: третья группа начинается с «7» (версия).
    expect(elements[first]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // order монотонно растёт — новая фигура сверху.
    expect(elements[second]!.order).toBeGreaterThan(elements[first]!.order);
  });

  it('закоммиченный элемент JSON-сериализуем (уедет в БД)', () => {
    const id = commit();
    const element = useDocumentStore.getState().elements[id];
    expect(JSON.parse(JSON.stringify(element))).toEqual(element);
  });

  it('updateElement правит существующий элемент', () => {
    const id = commit();

    useDocumentStore.getState().updateElement(id, { x: 999 });
    expect(useDocumentStore.getState().elements[id]?.x).toBe(999);
  });

  it('deleteElements удаляет один id из elements и elementIds синхронно', () => {
    const id = commit();

    useDocumentStore.getState().deleteElements([id]);
    const { elements, elementIds } = useDocumentStore.getState();
    expect(elementIds).not.toContain(id);
    expect(elements[id]).toBeUndefined();
  });

  it('deleteElements удаляет несколько id разом, не трогая остальные', () => {
    const first = commit();
    const second = commit();
    const third = commit();

    useDocumentStore.getState().deleteElements([first, third]);
    const { elements, elementIds } = useDocumentStore.getState();
    expect(elementIds).toEqual([second]);
    expect(elements[first]).toBeUndefined();
    expect(elements[third]).toBeUndefined();
    expect(elements[second]?.id).toBe(second);
  });

  it('deleteElements с пустым массивом — no-op', () => {
    commit();
    const before = useDocumentStore.getState().elementIds;

    useDocumentStore.getState().deleteElements([]);
    // Ссылка на массив не меняется — set фактически не тронул стор.
    expect(useDocumentStore.getState().elementIds).toBe(before);
  });

  it('держит порядок добавления в elementIds (будущий z-index)', () => {
    commit();
    commit();

    const { elementIds, elements } = useDocumentStore.getState();
    expect(elementIds).toHaveLength(2);
    expect(elementIds.every((id) => elements[id])).toBe(true);
  });
});

/** Серверная фигура для гидрации/remote-actions — форма CanvasElement с явными order/version. */
function serverRect(id: string, order: number, version = 0): CanvasElement {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    angle: 0,
    opacity: 1,
    stroke: '#000',
    fill: null,
    strokeWidth: 2,
    seed: 1,
    order,
    version,
    data: { width: 10, height: 10 },
  };
}

describe('useDocumentStore — autosave-события', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  afterEach(() => {
    setDocumentChangeListener(null);
  });

  it('commitElement уведомляет слушателя событием create с готовым элементом', () => {
    const changes: DocumentChange[] = [];
    setDocumentChangeListener((change) => changes.push(change));

    const id = commit();

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: 'create', element: { id } });
  });

  it('updateElement уведомляет событием update с id и патчем', () => {
    const id = commit();
    const changes: DocumentChange[] = [];
    setDocumentChangeListener((change) => changes.push(change));

    useDocumentStore.getState().updateElement(id, { x: 999 });

    expect(changes).toEqual([{ type: 'update', id, patch: { x: 999 } }]);
  });

  it('deleteElements уведомляет событием delete только по реально существовавшим id, с их version', () => {
    const id = commit();
    const changes: DocumentChange[] = [];
    setDocumentChangeListener((change) => changes.push(change));

    useDocumentStore.getState().deleteElements([id, 'never-existed']);

    expect(changes).toEqual([{ type: 'delete', deletions: [{ id, version: 0 }] }]);
  });

  it('пустое удаление и удаление несуществующего не дёргают слушателя', () => {
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().deleteElements([]);
    useDocumentStore.getState().deleteElements(['ghost']);

    expect(listener).not.toHaveBeenCalled();
  });

  it('hydrate заливает элементы, сортирует по order и НЕ уведомляет (нет autosave-петли)', () => {
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    // Приходят вперемешку — порядок восстанавливаем по order.
    useDocumentStore.getState().hydrate([serverRect('b', 5), serverRect('a', 1)]);

    const { elementIds, elements } = useDocumentStore.getState();
    expect(elementIds).toEqual(['a', 'b']);
    expect(elements.a?.id).toBe('a');
    expect(listener).not.toHaveBeenCalled();
  });

  it('после hydrate новый commit получает order выше максимального серверного', () => {
    useDocumentStore.getState().hydrate([serverRect('a', 10)]);

    const id = commit();
    expect(useDocumentStore.getState().elements[id]!.order).toBeGreaterThan(10);
  });

  it('reset не уведомляет слушателя (локальный сброс, не удаление на сервере)', () => {
    commit();
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().reset();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('useDocumentStore — remote-actions (SLT-39)', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  afterEach(() => {
    setDocumentChangeListener(null);
  });

  it('applyRemoteCreate добавляет чужой элемент и НЕ уведомляет слушателя (анти-петля)', () => {
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().applyRemoteCreate(serverRect('remote-1', 0, 0));

    const { elements, elementIds } = useDocumentStore.getState();
    expect(elementIds).toContain('remote-1');
    expect(elements['remote-1']?.id).toBe('remote-1');
    expect(listener).not.toHaveBeenCalled();
  });

  it('applyRemoteUpdate заменяет элемент целиком (broadcast несёт полный элемент, не дельту) и не уведомляет', () => {
    useDocumentStore.getState().hydrate([serverRect('a', 0, 0)]);
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().applyRemoteUpdate({ ...serverRect('a', 0, 1), x: 999 });

    const element = useDocumentStore.getState().elements.a;
    expect(element?.x).toBe(999);
    expect(element?.version).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('applyRemoteUpdate на неизвестный id вставляет его (свежий элемент, не потерянный)', () => {
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().applyRemoteUpdate(serverRect('unknown', 0, 2));

    expect(useDocumentStore.getState().elementIds).toContain('unknown');
    expect(listener).not.toHaveBeenCalled();
  });

  it('applyRemoteDelete убирает элемент из elements и elementIds синхронно, не уведомляет', () => {
    useDocumentStore.getState().hydrate([serverRect('a', 0)]);
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().applyRemoteDelete('a');

    const { elements, elementIds } = useDocumentStore.getState();
    expect(elements.a).toBeUndefined();
    expect(elementIds).not.toContain('a');
    expect(listener).not.toHaveBeenCalled();
  });

  it('applyRemoteDelete на несуществующий id — no-op, не уведомляет', () => {
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().applyRemoteDelete('ghost');

    expect(listener).not.toHaveBeenCalled();
  });

  it('чужая мутация того же элемента виден в СВОЁМ следующем commit/update — не флаг, отдельный путь', () => {
    // Регрессия ровно на решение Р4 SLT-39: remote-путь и локальный commit/update физически
    // разные функции — применение чужого не может случайно поставить «свой» флаг и наоборот.
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().applyRemoteCreate(serverRect('remote-2', 0, 0));
    expect(listener).not.toHaveBeenCalled();

    useDocumentStore.getState().updateElement('remote-2', { x: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: 'update', id: 'remote-2', patch: { x: 5 } });
  });
});

describe('useDocumentStore — syncElementVersion (SLT-39)', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
  });

  afterEach(() => {
    setDocumentChangeListener(null);
  });

  it('тихо обновляет version существующего элемента, не уведомляя слушателя', () => {
    const id = commit();
    const listener = vi.fn();
    setDocumentChangeListener(listener);

    useDocumentStore.getState().syncElementVersion(id, 7);

    expect(useDocumentStore.getState().elements[id]?.version).toBe(7);
    expect(listener).not.toHaveBeenCalled();
  });

  it('следующая своя мутация того же элемента видит уже обновлённую version', () => {
    const id = commit();
    useDocumentStore.getState().syncElementVersion(id, 7);

    expect(useDocumentStore.getState().elements[id]?.version).toBe(7);

    // Именно это читает orchestrator (useCanvasSync) перед отправкой следующего element_update.
    useDocumentStore.getState().updateElement(id, { x: 1 });
    expect(useDocumentStore.getState().elements[id]?.version).toBe(7);
  });

  it('syncElementVersion на несуществующий id — no-op, без исключения', () => {
    expect(() => useDocumentStore.getState().syncElementVersion('ghost', 1)).not.toThrow();
  });
});
