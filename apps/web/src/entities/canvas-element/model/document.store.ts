import { v7 as uuidv7 } from 'uuid';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { normalizeBounds, SCHEMA_VERSION } from './element';
import type {
  BaseElement,
  CanvasDocument,
  CanvasElement,
  DraftElement,
  ElementData,
} from './types';

/**
 * Патч элемента для точечных апдейтов (драг, будущий реалтайм/ресайз). Только мутабельные общие
 * поля + геометрия целиком (`data`): id/type/seed менять нельзя. Множество полей — подмножество
 * серверного PATCH-контракта (patchElementSchema), чтобы патч уезжал на бэк без переукладки.
 */
export type ElementPatch = Partial<
  Pick<BaseElement, 'x' | 'y' | 'angle' | 'opacity' | 'stroke' | 'fill' | 'strokeWidth' | 'order'>
> & {
  data?: ElementData;
};

/**
 * Семантическое изменение документа — то, что autosave (widgets/canvas, SLT-27) превращает в
 * HTTP-метод: create → PUT, update → PATCH, delete → DELETE. Намерение известно здесь, в экшене,
 * поэтому метод не реконструируется из diff состояния.
 *
 * Событие несёт ровно то, что нужно для запроса: create — весь элемент (для PUT нужно тело
 * целиком), update — id + патч, delete — список id.
 */
export type DocumentChange =
  | { type: 'create'; element: CanvasElement }
  | { type: 'update'; id: string; patch: ElementPatch }
  | { type: 'delete'; ids: string[] };

type DocumentChangeListener = (change: DocumentChange) => void;

/**
 * Единственный слушатель изменений (autosave-оркестратор виджета холста). Не массив: холст
 * смонтирован в одном экземпляре. Регистрируется на монтировании, снимается на размонтировании.
 *
 * КРИТИЧНО: гидрация (`hydrate`) и `reset` НЕ уведомляют слушателя. Иначе заливка серверных
 * элементов при открытии доски отправила бы их обратно (PUT только что полученного) — autosave-
 * петля. Уведомляют только пользовательские экшены (commit/update/delete).
 */
let changeListener: DocumentChangeListener | null = null;

export function setDocumentChangeListener(listener: DocumentChangeListener | null): void {
  changeListener = listener;
}

function emitChange(change: DocumentChange): void {
  changeListener?.(change);
}

interface DocumentActions {
  /** Переносит черновик в документ: нормализует, генерит id (uuid v7) и order, добавляет в z-order. */
  commitElement: (draft: DraftElement) => void;
  updateElement: (id: string, patch: ElementPatch) => void;
  /**
   * Единственный путь удаления. Убирает пачку элементов разом: вычищает их из elements и из
   * elementIds одним атомарным set. «Удалить один» — это deleteElements([id]).
   */
  deleteElements: (ids: string[]) => void;
  /**
   * Заливает элементы с сервера (гидрация при открытии доски). Полностью заменяет документ и
   * восстанавливает z-order сортировкой по `order`. НЕ уведомляет слушателя — см. changeListener.
   */
  hydrate: (elements: CanvasElement[]) => void;
  /** Сброс документа (открытие/размонтирование доски, тесты). НЕ уведомляет слушателя. */
  reset: () => void;
}

export type DocumentStore = CanvasDocument & DocumentActions;

const INITIAL: CanvasDocument = {
  schemaVersion: SCHEMA_VERSION,
  elements: {},
  elementIds: [],
};

/**
 * Следующий z-order: на единицу больше максимального среди существующих. Пустой документ
 * стартует с 0. Достаточно для append-only (вставки между соседями/переупорядочивания в этапе 1
 * нет): порядок монотонно растёт, новая фигура всегда сверху.
 */
function nextOrder(elements: Record<string, CanvasElement>, elementIds: string[]): number {
  let max = -1;
  for (const id of elementIds) {
    const element = elements[id];
    if (element && element.order > max) max = element.order;
  }
  return max + 1;
}

/**
 * Стор документа — единственный источник правды о фигурах и то, что уезжает в бэк (SLT-27).
 * immer даёт «мутабельный» синтаксис поверх иммутабельных апдейтов.
 *
 * Инвариант elements ↔ elementIds enforce-ится ТОЛЬКО здесь, в экшенах. id/order генерятся здесь,
 * а не в компоненте: один жест = один commitElement = одна фигура с готовым серверным id.
 */
export const useDocumentStore = create<DocumentStore>()(
  immer((set, get) => ({
    ...INITIAL,

    commitElement: (draft) => {
      const id = uuidv7();
      const { elements, elementIds } = get();
      const order = nextOrder(elements, elementIds);
      // normalizeBounds сохраняет дискриминант type; добавление id+order даёт валидный член
      // союза CanvasElement (вывод типа без приведения — как и раньше).
      const element: CanvasElement = { ...normalizeBounds(draft), id, order };

      set((state) => {
        state.elements[id] = element;
        state.elementIds.push(id);
      });

      emitChange({ type: 'create', element });
    },

    updateElement: (id, patch) => {
      let applied = false;
      set((state) => {
        const element = state.elements[id];
        if (!element) return;
        Object.assign(element, patch);
        applied = true;
      });

      if (applied) emitChange({ type: 'update', id, patch });
    },

    deleteElements: (ids) => {
      if (ids.length === 0) return; // пустой ввод — не дёргаем ни подписчиков, ни сеть

      // Set для O(1) проверки принадлежности. removed — только реально существовавшие id,
      // чтобы на сервер не улетел DELETE по несуществующему элементу.
      const toDelete = new Set(ids);
      const removed: string[] = [];

      set((state) => {
        for (const id of state.elementIds) {
          if (toDelete.has(id)) removed.push(id);
        }
        // Оба контейнера правим в одном set — между кадрами нет висячего id (рендер достал бы
        // undefined) и Transformer на мёртвом узле.
        for (const id of toDelete) delete state.elements[id];
        state.elementIds = state.elementIds.filter((id) => !toDelete.has(id));
      });

      if (removed.length > 0) emitChange({ type: 'delete', ids: removed });
    },

    hydrate: (elements) =>
      set((state) => {
        // Порядок отрисовки восстанавливаем из серверного order (elementIds на клиенте — z-index).
        const sorted = [...elements].sort((a, b) => a.order - b.order);
        state.elements = {};
        state.elementIds = [];
        for (const element of sorted) {
          state.elements[element.id] = element;
          state.elementIds.push(element.id);
        }
      }),

    reset: () =>
      set((state) => {
        state.elements = {};
        state.elementIds = [];
      }),
  })),
);
