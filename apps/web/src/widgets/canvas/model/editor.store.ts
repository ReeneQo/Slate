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
  /**
   * id закоммиченного text-элемента, который сейчас ре-редактируется оверлеем (SLT-61,
   * dblclick). Отдельно от `draft`: `draft` — путь СОЗДАНИЯ (фигуры ещё нет в document-сторе,
   * id нет вовсе), `editingTextId` — путь РЕДАКТИРОВАНИЯ существующей, уже закоммиченной фигуры
   * по id. Смешивать их в одном поле означало бы различать «create vs edit» по наличию/отсутствию
   * id внутри значения — источник ошибок при рефакторинге; так инвариант виден в самой форме
   * стора. Ровно одно из двух активно одновременно — это обеспечивают вызывающие (см.
   * useDrawing.start и будущий dblclick-обработчик, SLT-61 Точка сверки 2).
   */
  editingTextId: string | null;
  /**
   * Рамка marquee-выделения (SLT-64), эфемерна — живёт только на время mousedown→mouseup по
   * пустому месту в select-режиме. НЕ в document-сторе и НЕ в контракте: чисто UI-жест, аналог
   * `draft` для рисования (см. useDrawing) — width/height всегда неотрицательны (нормализованы
   * под драг в любую сторону), готовы к прямому рендеру Konva.Rect.
   */
  marqueeRect: { x: number; y: number; width: number; height: number } | null;
  /**
   * Идёт ли сейчас нативный Konva drag фигуры (одиночный или group-drag, SLT-64) — читается
   * ТОЛЬКО гвардом undo/redo/delete хоткеев (SLT-65), чтобы не перехватывать клавишу посреди
   * незавершённого жеста. Параллельно локальному `isDraggingShape` в useCanvasInteraction (тот
   * держит курсор «move» на весь жест) — НЕ заменяет его: consolidation двух drag-флагов не входит
   * в объём SLT-65, оставлено мелким долгом.
   */
  isDraggingElement: boolean;
}

interface EditorActions {
  setTool: (tool: ToolType) => void;
  setDraft: (draft: DraftElement | null) => void;
  setViewport: (viewport: Viewport) => void;
  setSelectedElementIds: (ids: string[]) => void;
  setCanEdit: (canEdit: boolean) => void;
  setEditingTextId: (id: string | null) => void;
  clearEditingTextId: () => void;
  setMarqueeRect: (rect: EditorState['marqueeRect']) => void;
  setDraggingElement: (isDragging: boolean) => void;
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
    editingTextId: null,
    marqueeRect: null,
    isDraggingElement: false,

    setTool: (tool) =>
      set((state) => {
        state.selectedTool = tool;
        // Смена инструмента отменяет незакоммиченный черновик.
        state.draft = null;
        // Симметрично draft: смена инструмента — тот же защитный сброс для незакоммиченного
        // ре-редактирования text (dblclick), иначе оверлей мог бы остаться открытым поверх уже
        // переключённого на другой инструмент холста (обычно это перехватывает blur textarea,
        // но смена инструмента не обязана зависеть от порядка DOM-событий).
        state.editingTextId = null;
        // Выделение — концепт select-режима. Уходя на инструмент рисования,
        // снимаем его, иначе рамка Transformer «зависнет» поверх рисования.
        if (tool !== 'select') state.selectedElementIds = [];
        // Marquee — тоже концепт select-режима (см. draft/editingTextId выше): жест marquee
        // существует только в select, смена инструмента посреди тяги рамки не должна оставить
        // её висеть поверх уже переключённого холста.
        state.marqueeRect = null;
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

    setEditingTextId: (id) =>
      set((state) => {
        state.editingTextId = id;
      }),

    clearEditingTextId: () =>
      set((state) => {
        state.editingTextId = null;
      }),

    setMarqueeRect: (rect) =>
      set((state) => {
        state.marqueeRect = rect;
      }),

    setDraggingElement: (isDragging) =>
      set((state) => {
        state.isDraggingElement = isDragging;
      }),
  })),
);
