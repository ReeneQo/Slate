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
 * Семантическое изменение документа — то, что autosave (widgets/canvas, SLT-27/39) превращает в
 * WS-мутацию: create → `element_create`, update → `element_update`, delete → `element_delete`.
 * Намерение известно здесь, в экшене, поэтому метод не реконструируется из diff состояния.
 *
 * Событие несёт ровно то, что нужно для запроса: create — весь элемент (тело создания нужно
 * целиком), update — id + патч (version на момент отправки orchestrator читает из стора отдельно,
 * патч её не трогает), delete — id ВМЕСТЕ с version, снятой в момент удаления (SLT-39): элемент
 * уже вычищен из `elements` к моменту, когда слушатель асинхронно отправит запрос, — version
 * неоткуда прочитать позже, кроме как из самого события.
 */
export type DocumentChange =
  | { type: 'create'; element: CanvasElement }
  | { type: 'update'; id: string; patch: ElementPatch }
  | { type: 'delete'; deletions: { id: string; version: number }[] };

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

/**
 * Слушатель истории (SLT-65) — так же единственный и так же не уведомляется на hydrate/reset/
 * remote-путях, как changeListener выше, но сообщает НЕ то, что отправить на сервер, а инверсию
 * для undo: какие элементы появились (→ инверсия «удалить»), какой был патч ДО апдейта (→
 * инверсия «применить старое»), какие элементы целиком исчезли (→ инверсия «пересоздать»).
 *
 * Регистрируется РАЗ на весь app lifecycle (history.store.ts, модульная область видимости) — в
 * отличие от changeListener, который живёт по одному на смонтированную доску (autosave-
 * оркестратор перевешивает его на каждый маунт). Истории не нужен boardId, поэтому и
 * перерегистрация не нужна: document.store.ts НЕ импортирует history.store.ts (обратная ссылка
 * ушла бы в цикл, `import/no-cycle`), history.store.ts импортирует document.store.ts и сам
 * регистрируется здесь через setHistoryRecorder при загрузке модуля.
 */
export interface DocumentHistoryRecorder {
  /** Элементы созданы локально (commitElement — всегда один; restoreElements — может быть много). */
  onCreated: (elements: CanvasElement[]) => void;
  /** Элемент обновлён локально; patch — СТАРЫЕ значения ровно тех полей, что были в новом патче. */
  onUpdated: (id: string, patch: ElementPatch) => void;
  /** Элементы удалены локально, ПОЛНЫЕ снимки (для восстановления инверсией). */
  onDeleted: (elements: CanvasElement[]) => void;
}

let historyRecorder: DocumentHistoryRecorder | null = null;

export function setHistoryRecorder(recorder: DocumentHistoryRecorder | null): void {
  historyRecorder = recorder;
}

/**
 * Старые значения ровно тех полей, что затронуты патчем (для инверсии update, SLT-65). `element` —
 * снимок ДО применения патча (см. вызов в updateElement, снят через get() до set() — immer COW
 * гарантирует, что это НЕ мутируемая draft-ссылка, а честно старый объект).
 */
function snapshotPatchFields(element: CanvasElement, patch: ElementPatch): ElementPatch {
  const before: ElementPatch = {};
  if ('x' in patch) before.x = element.x;
  if ('y' in patch) before.y = element.y;
  if ('angle' in patch) before.angle = element.angle;
  if ('opacity' in patch) before.opacity = element.opacity;
  if ('stroke' in patch) before.stroke = element.stroke;
  if ('fill' in patch) before.fill = element.fill;
  if ('strokeWidth' in patch) before.strokeWidth = element.strokeWidth;
  if ('order' in patch) before.order = element.order;
  if ('data' in patch) before.data = element.data;
  return before;
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
   * Пересоздаёт готовые элементы КАК ЕСТЬ — с их собственными id/order (SLT-65). В отличие от
   * commitElement (всегда новый id), нужен для инверсии: undo(delete) воскрешает снятые элементы
   * под теми же id, redo(create) повторяет создание под тем же id, что и в первый раз. Эмитит
   * `create` на каждый элемент — WS уже поддерживает явный id в element_create (та же тройная
   * семантика create/replace/resurrect, что у HTTP PUT), новый транспорт не нужен.
   */
  restoreElements: (elements: CanvasElement[]) => void;
  /**
   * Заливает элементы с сервера (гидрация при открытии доски). Полностью заменяет документ и
   * восстанавливает z-order сортировкой по `order`. НЕ уведомляет слушателя — см. changeListener.
   */
  hydrate: (elements: CanvasElement[]) => void;
  /** Сброс документа (открытие/размонтирование доски, тесты). НЕ уведомляет слушателя. */
  reset: () => void;

  /**
   * Remote-actions (SLT-39) — применяют мутацию, пришедшую WS-broadcast'ом от ДРУГОГО участника
   * комнаты (`element_created`/`element_updated`/`element_deleted`). Отдельные функции, а не
   * флаг `{ remote: true }` на обычных экшенах: флаг хрупок (забудешь выставить — вернётся
   * autosave-петля), отдельная функция физически не может дёрнуть emitChange, потому что просто
   * не зовёт его — тот же приём, что у hydrate/reset.
   *
   * НЕ различают своё/чужое по userId (ловушка двух вкладок одного юзера — SLT-39): вызывающий
   * (useCanvasSync) обязан звать их ТОЛЬКО на входящий broadcast, где анти-эхо уже обеспечено
   * сервером (`socket.to`, отправитель свой же broadcast не получает).
   *
   * Broadcast несёт ПОЛНЫЙ элемент (не дельту, SLT-38) — поэтому create/update здесь делают
   * буквально одно и то же (upsert по id); названы раздельно ради симметрии с локальной парой
   * commit/update и на случай будущего расхождения в обработке.
   */
  applyRemoteCreate: (element: CanvasElement) => void;
  applyRemoteUpdate: (element: CanvasElement) => void;
  applyRemoteDelete: (id: string) => void;

  /**
   * Тихо синхронизирует `version` элемента из ack собственной WS-мутации (create/update, SLT-39)
   * — подтверждение уже отправленного, а не новое изменение, поэтому НЕ уведомляет слушателя
   * (иначе подтверждение своей же правки само стало бы поводом для нового autosave-запроса).
   * Без этого следующая правка того же элемента унесла бы устаревшую version и мгновенно
   * получила бы `version_conflict` от сервера.
   */
  syncElementVersion: (id: string, version: number) => void;
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
      // normalizeBounds сохраняет дискриминант type; добавление id+order+version даёт валидный
      // член союза CanvasElement (вывод типа без приведения — как и раньше). version: 0 —
      // оптимистическое совпадение с дефолтом новой строки в БД (SLT-39); ack на element_create
      // подтвердит его через syncElementVersion, тихо, без нового autosave-запроса.
      const element: CanvasElement = { ...normalizeBounds(draft), id, order, version: 0 };

      set((state) => {
        state.elements[id] = element;
        state.elementIds.push(id);
      });

      emitChange({ type: 'create', element });
      historyRecorder?.onCreated([element]);
    },

    updateElement: (id, patch) => {
      // Снимок ДО set() (SLT-65, П3): get() отдаёт предыдущее, ещё не тронутое immer-состояние —
      // честная старая ссылка, не draft-proxy, который читался бы изнутри set() и стал бы
      // небезопасен после финализации producer'а.
      const before = get().elements[id];
      let applied = false;
      set((state) => {
        const element = state.elements[id];
        if (!element) return;
        Object.assign(element, patch);
        applied = true;
      });

      if (applied) {
        emitChange({ type: 'update', id, patch });
        if (before) historyRecorder?.onUpdated(id, snapshotPatchFields(before, patch));
      }
    },

    deleteElements: (ids) => {
      if (ids.length === 0) return; // пустой ввод — не дёргаем ни подписчиков, ни сеть

      // Set для O(1) проверки принадлежности. Снимаем ДО set() (SLT-65, П3, тот же приём, что в
      // updateElement) — и компактный {id,version} для WS (SLT-39), и ПОЛНЫЙ элемент для истории
      // (инверсия delete — пересоздать снятое целиком, а не только id/version).
      const toDelete = new Set(ids);
      const { elements, elementIds } = get();
      const removed: { id: string; version: number }[] = [];
      const removedElements: CanvasElement[] = [];
      for (const id of elementIds) {
        const element = elements[id];
        if (toDelete.has(id) && element) {
          removed.push({ id, version: element.version });
          removedElements.push(element);
        }
      }

      set((state) => {
        // Оба контейнера правим в одном set — между кадрами нет висячего id (рендер достал бы
        // undefined) и Transformer на мёртвом узле.
        for (const id of toDelete) delete state.elements[id];
        state.elementIds = state.elementIds.filter((id) => !toDelete.has(id));
      });

      if (removed.length > 0) {
        emitChange({ type: 'delete', deletions: removed });
        historyRecorder?.onDeleted(removedElements);
      }
    },

    restoreElements: (elements) => {
      if (elements.length === 0) return;

      set((state) => {
        for (const element of elements) {
          if (!(element.id in state.elements)) state.elementIds.push(element.id);
          state.elements[element.id] = element;
        }
      });

      for (const element of elements) {
        emitChange({ type: 'create', element });
      }
      historyRecorder?.onCreated(elements);
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

    // --- Remote-actions и синхронизация version (SLT-39) — см. докстринги в DocumentActions.
    // НЕ зовут emitChange НИ В ОДНОЙ ветке: это единственная гарантия от autosave-петли, та же,
    // что у hydrate/reset.

    applyRemoteCreate: (element) =>
      set((state) => {
        if (!(element.id in state.elements)) state.elementIds.push(element.id);
        state.elements[element.id] = element;
      }),

    applyRemoteUpdate: (element) =>
      set((state) => {
        if (!(element.id in state.elements)) state.elementIds.push(element.id);
        state.elements[element.id] = element;
      }),

    applyRemoteDelete: (id) =>
      set((state) => {
        if (!(id in state.elements)) return;
        delete state.elements[id];
        state.elementIds = state.elementIds.filter((existingId) => existingId !== id);
      }),

    syncElementVersion: (id, version) =>
      set((state) => {
        const element = state.elements[id];
        if (element) element.version = version;
      }),
  })),
);
