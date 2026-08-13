import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { type ElementPatch, setHistoryRecorder, useDocumentStore } from './document.store';
import type { CanvasElement } from './types';

/**
 * Клиентская локальная история холста (SLT-65) — команды/инверсии, НЕ снапшоты. Каждая операция —
 * инверсия ОДНОЙ document-мутации, сформированная централизованно в document.store.ts (см.
 * DocumentHistoryRecorder) в момент, когда старое значение ещё под рукой. Применение инверсии
 * (undo/redo) идёт ЧЕРЕЗ ТЕ ЖЕ мутаторы document-стора (updateElement/deleteElements/
 * restoreElements) — значит уезжает в WS обычным путём (SLT-39), без отдельного undo-транспорта.
 *
 * Три вида инверсии — ровно по числу локальных мутаторов, которые их порождают:
 *  - `create(elements)` — инверсия delete: пересоздать снятые элементы целиком (restoreElements).
 *  - `update(id, patch)` — инверсия update: применить старые значения затронутых полей.
 *  - `delete(ids)` — инверсия create: удалить только что созданные id (deleteElements).
 */
export type InverseOp =
  | { kind: 'create'; elements: CanvasElement[] }
  | { kind: 'update'; id: string; patch: ElementPatch }
  | { kind: 'delete'; ids: string[] };

/** Один шаг undo/redo — может нести несколько операций (group-drag/multi-resize, SLT-65 Р2). */
export interface HistoryTransaction {
  operations: InverseOp[];
}

/**
 * Режим записи (SLT-65, ключевая развилка «как не зациклить undo»). Мутаторы document-стора
 * ВСЕГДА уведомляют recorder — они не знают и не должны знать, кто их вызвал (пользователь или
 * сама история, применяющая инверсию). Разруливает это ТОЛЬКО recordOp здесь, по режиму:
 *  - 'record' — обычное пользовательское действие: операция уходит в `past`, `future` чистится
 *    (Р5 — новое действие обрубает redo).
 *  - 'undo' — undo() применяет инверсию транзакции ЧЕРЕЗ мутаторы; они, применяя её, сами
 *    формируют СВОЮ инверсию (это и есть операция для redo) — recordOp в этом режиме кладёт её в
 *    `future`, НЕ в `past` (иначе применение undo само стало бы новым шагом undo — цикл) и NE
 *    чистит `future` (это не «новое действие», а другая половина той же пары).
 *  - 'redo' — симметрично: результат кладётся в `past`.
 */
type HistoryMode = 'record' | 'undo' | 'redo';

let mode: HistoryMode = 'record';
/** Открытый аккумулятор транзакции. null — каждая операция сама себе транзакция (Р2). Один и тот
 * же механизм обслуживает и явные begin/end (group-drag, multi-resize), и undo()/redo() (которые
 * группируют применение ЦЕЛОЙ исторической транзакции обратно в одну). */
let currentTransaction: InverseOp[] | null = null;

/** Начинает явную транзакцию — group-drag/multi-resize вызывают перед пакетом мутаций (Р2/Р4 факт G). */
export function beginTransaction(): void {
  if (currentTransaction) return; // вложенность не ожидается вызывающими — без неё безопасно no-op
  currentTransaction = [];
}

/** Закрывает явную транзакцию, фиксируя накопленные операции одним шагом истории. */
export function endTransaction(): void {
  if (!currentTransaction) return;
  const operations = currentTransaction;
  currentTransaction = null;
  if (operations.length === 0) return; // нечего фиксировать (напр. resize без реального изменения)
  commitTransaction({ operations });
}

function commitTransaction(transaction: HistoryTransaction): void {
  if (mode === 'record') {
    useHistoryStore.setState((state) => {
      state.past.push(transaction);
      state.future = [];
    });
  } else if (mode === 'undo') {
    useHistoryStore.setState((state) => {
      state.future.push(transaction);
    });
  } else {
    useHistoryStore.setState((state) => {
      state.past.push(transaction);
    });
  }
}

/** Пишет одну операцию — в открытую транзакцию, если она есть, иначе как транзакцию из одной. */
function recordOp(op: InverseOp): void {
  if (currentTransaction) {
    currentTransaction.push(op);
    return;
  }
  commitTransaction({ operations: [op] });
}

// Регистрация РАЗ на весь app lifecycle — см. докстринг DocumentHistoryRecorder в document.store.ts.
// Однонаправленная связь (history.store → document.store): document.store НЕ импортирует этот
// модуль, поэтому цикла нет (import/no-cycle).
setHistoryRecorder({
  onCreated: (elements) => recordOp({ kind: 'delete', ids: elements.map((element) => element.id) }),
  onUpdated: (id, patch) => recordOp({ kind: 'update', id, patch }),
  onDeleted: (elements) => recordOp({ kind: 'create', elements }),
});

/** Применяет одну инверсию через мутаторы document-стора — уезжает в WS обычным путём (SLT-39). */
function applyOp(op: InverseOp): void {
  const { updateElement, deleteElements, restoreElements } = useDocumentStore.getState();
  switch (op.kind) {
    case 'create':
      restoreElements(op.elements);
      break;
    case 'update':
      updateElement(op.id, op.patch);
      break;
    case 'delete':
      deleteElements(op.ids);
      break;
  }
}

interface HistoryState {
  past: HistoryTransaction[];
  future: HistoryTransaction[];
}

interface HistoryActions {
  undo: () => void;
  redo: () => void;
  /** Сброс истории (открытие/размонтирование доски, SLT-65) — своя история одной доски не должна
   * протечь в другую при переключении (тот же приём, что document.store.reset). */
  reset: () => void;
}

export type HistoryStore = HistoryState & HistoryActions;

export const useHistoryStore = create<HistoryStore>()(
  immer((set, get) => ({
    past: [],
    future: [],

    undo: () => {
      const { past } = get();
      const transaction = past[past.length - 1];
      if (!transaction) return;

      set((state) => {
        state.past.pop();
      });

      mode = 'undo';
      try {
        beginTransaction();
        // Обратный порядок — корректная инверсия, если операции внутри транзакции когда-либо
        // окажутся зависимыми (сейчас это не так: group-drag/multi-resize бьют по разным id).
        for (let i = transaction.operations.length - 1; i >= 0; i--) {
          applyOp(transaction.operations[i]!);
        }
        endTransaction();
      } finally {
        // Гарантированный возврат в 'record' — иначе исключение внутри applyOp «залипило» бы
        // режим, и следующее обычное действие пользователя ушло бы не в тот стек молча.
        mode = 'record';
      }
    },

    redo: () => {
      const { future } = get();
      const transaction = future[future.length - 1];
      if (!transaction) return;

      set((state) => {
        state.future.pop();
      });

      mode = 'redo';
      try {
        beginTransaction();
        for (const op of transaction.operations) {
          applyOp(op);
        }
        endTransaction();
      } finally {
        mode = 'record';
      }
    },

    reset: () => {
      currentTransaction = null;
      mode = 'record';
      set((state) => {
        state.past = [];
        state.future = [];
      });
    },
  })),
);
