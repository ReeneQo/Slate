import { beforeEach, describe, expect, it } from 'vitest';

import { useDocumentStore } from './document.store';
import { createDraft, updateDraftGeometry } from './element';

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
    expect(element).toMatchObject({ x: 60, y: 100, width: 40, height: 40 });
    expect(element?.id).toBeTruthy();
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
