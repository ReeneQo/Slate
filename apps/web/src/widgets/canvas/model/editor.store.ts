import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { DraftElement, ToolType } from '@/entities/canvas-element';
import type { Viewport } from '@/shared/lib/viewport';

/**
 * UI/сессионное состояние редактора холста. В отличие от документа, НЕ уходит в бэк
 * и НЕ в историю: выбранный инструмент, выделение, рисуемый сейчас черновик
 * и персональный вьюпорт (pan/zoom).
 *
 * Живёт в widgets/canvas, а не в entities: это не доменная сущность, а сессионное
 * состояние конкретного виджета-холста. Его потребители (рисование, тулбар,
 * оркестратор ввода) тоже сидят на уровне холста и ниже не нужны.
 *
 * Разделение со стором документа осознанное: document-стор — данные доски (общие,
 * версионируемые), editor-стор — как конкретный юзер сейчас на них смотрит и что делает.
 */
interface EditorState {
  selectedTool: ToolType;
  selectedElementIds: string[];
  /** Фигура, которую тащим прямо сейчас. Эфемерна — живёт только до коммита. */
  draft: DraftElement | null;
  viewport: Viewport;
  /**
   * Роль-гейт холста (SLT-43, `deriveCanEdit`): может ли текущий юзер мутировать документ.
   * Живёт здесь, а не пропом сквозь каждый обработчик ввода (useDrawing/useCanvasHotkeys/
   * useCanvasInteraction уже читают этот стор через getState() по тому же паттерну, что
   * `viewport`/`selectedTool`) — единая точка чтения вместо размазанного «if viewer» по местам.
   * Дефолт `false`: до первого вызова `setCanEdit` (роль ещё не резолвилась) холст read-only —
   * тот же безопасный дефолт, что и у `deriveCanEdit(undefined)`.
   */
  canEdit: boolean;
}

interface EditorActions {
  setTool: (tool: ToolType) => void;
  setDraft: (draft: DraftElement | null) => void;
  setViewport: (viewport: Viewport) => void;
  setSelectedElementIds: (ids: string[]) => void;
  setCanEdit: (canEdit: boolean) => void;
}

export type EditorStore = EditorState & EditorActions;

const INITIAL_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 };

export const useEditorStore = create<EditorStore>()(
  immer((set) => ({
    selectedTool: 'select',
    selectedElementIds: [],
    draft: null,
    viewport: INITIAL_VIEWPORT,
    canEdit: false,

    setTool: (tool) =>
      set((state) => {
        state.selectedTool = tool;
        // Смена инструмента отменяет незакоммиченный черновик.
        state.draft = null;
        // Выделение — концепт select-режима. Уходя на инструмент рисования,
        // снимаем его, иначе рамка Transformer «зависнет» поверх рисования.
        if (tool !== 'select') state.selectedElementIds = [];
      }),

    setDraft: (draft) =>
      set((state) => {
        state.draft = draft;
      }),

    setViewport: (viewport) =>
      set((state) => {
        state.viewport = viewport;
      }),

    setSelectedElementIds: (ids) =>
      set((state) => {
        state.selectedElementIds = ids;
      }),

    setCanEdit: (canEdit) =>
      set((state) => {
        state.canEdit = canEdit;
      }),
  })),
);
