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
}

interface EditorActions {
  setTool: (tool: ToolType) => void;
  setDraft: (draft: DraftElement | null) => void;
  setViewport: (viewport: Viewport) => void;
  setSelectedElementIds: (ids: string[]) => void;
}

export type EditorStore = EditorState & EditorActions;

const INITIAL_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 };

export const useEditorStore = create<EditorStore>()(
  immer((set) => ({
    selectedTool: 'select',
    selectedElementIds: [],
    draft: null,
    viewport: INITIAL_VIEWPORT,

    setTool: (tool) =>
      set((state) => {
        state.selectedTool = tool;
        // Смена инструмента отменяет незакоммиченный черновик.
        state.draft = null;
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
  })),
);
