import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { normalizeBounds, SCHEMA_VERSION } from './element';
import type { BaseElement, CanvasDocument, DraftElement } from './types';

/**
 * Патч элемента для точечных апдейтов (драг, будущий реалтайм). Только мутабельная
 * геометрия и стиль: id/type/seed менять нельзя.
 */
export type ElementPatch = Partial<
  Pick<BaseElement, 'x' | 'y' | 'angle' | 'opacity' | 'stroke' | 'fill' | 'strokeWidth'>
> & {
  width?: number;
  height?: number;
  points?: number[];
};

interface DocumentActions {
  /** Переносит черновик в документ: нормализует, генерит id, добавляет в z-order. */
  commitElement: (draft: DraftElement) => void;
  updateElement: (id: string, patch: ElementPatch) => void;
  /**
   * Единственный путь удаления. Убирает пачку элементов разом: вычищает их из
   * elements и из elementIds одним атомарным set. «Удалить один» — это
   * deleteElements([id]), отдельного removeElement нет намеренно (один способ
   * удаления = нет рассинхрона). Коммитящая операция — в ряду commitElement/
   * updateElement, под будущий undo/redo.
   */
  deleteElements: (ids: string[]) => void;
  /** Сброс документа (новая доска / тесты). */
  reset: () => void;
}

export type DocumentStore = CanvasDocument & DocumentActions;

const INITIAL: CanvasDocument = {
  schemaVersion: SCHEMA_VERSION,
  elements: {},
  elementIds: [],
};

/**
 * Стор документа — единственный источник правды о фигурах. Это то, что уедет
 * в бэк (этап 2) и в историю (undo/redo). immer даёт «мутабельный» синтаксис
 * поверх иммутабельных апдейтов — экшены читаются как прямые изменения.
 *
 * Инвариант elements ↔ elementIds enforce-ится ТОЛЬКО здесь, в экшенах:
 * снаружи документ менять нельзя, поэтому рассинхрон невозможен.
 *
 * id генерится здесь, а не в компоненте/во время превью (решение контракта):
 * один жест = один commitElement = один будущий шаг истории.
 */
export const useDocumentStore = create<DocumentStore>()(
  immer((set) => ({
    ...INITIAL,

    commitElement: (draft) =>
      set((state) => {
        const id = nanoid();
        // normalizeBounds сохраняет дискриминант type, поэтому добавление id
        // даёт валидный член союза CanvasElement (вывод типа без приведения).
        state.elements[id] = { ...normalizeBounds(draft), id };
        state.elementIds.push(id);
      }),

    updateElement: (id, patch) =>
      set((state) => {
        const element = state.elements[id];
        if (!element) return;
        Object.assign(element, patch);
      }),

    deleteElements: (ids) =>
      set((state) => {
        if (ids.length === 0) return; // пустой ввод — не дёргаем подписчиков впустую
        // Set для O(1) проверки принадлежности: filter по elementIds становится
        // O(n), а не O(n·m). Оба контейнера правим в одном set — между кадрами
        // нет висячего id (рендер достал бы undefined) и Transformer на мёртвом узле.
        const toDelete = new Set(ids);
        for (const id of toDelete) delete state.elements[id];
        state.elementIds = state.elementIds.filter((id) => !toDelete.has(id));
      }),

    reset: () =>
      set((state) => {
        state.elements = {};
        state.elementIds = [];
      }),
  })),
);
