import { useCallback } from 'react';

import {
  createDraft,
  isCommittable,
  updateDraftGeometry,
  useDocumentStore,
} from '@/entities/canvas-element';
import { type Point, screenToCanvas } from '@/shared/lib/viewport';

import { useEditorStore } from '../model/editor.store';

/**
 * Контроллер рисования клик-драгом. Возвращает «эфемерные» шаги жеста:
 *  start  — на mousedown: создаёт черновик выбранного инструмента;
 *  move   — на mousemove: тянет геометрию черновика за курсором;
 *  end    — на mouseup: коммитит черновик в документ (один жест = один коммит).
 *
 * Текущее состояние читаем через getState() прямо в обработчиках, а не из
 * замыкания: это всегда свежие данные (нет устаревших closure-значений) и нет
 * лишних подписок/ре-рендеров на каждый mousemove.
 *
 * Принимает экранные координаты указателя и сам переводит их в координаты холста
 * с учётом текущего вьюпорта — координаты элементов всегда «мировые».
 */
export interface DrawingController {
  /** true — жест начат (выбран инструмент рисования); false — нечего рисовать. */
  start: (screen: Point) => boolean;
  move: (screen: Point) => void;
  end: () => void;
}

export function useDrawing(): DrawingController {
  const setDraft = useEditorStore((state) => state.setDraft);
  const setTool = useEditorStore((state) => state.setTool);
  const commitElement = useDocumentStore((state) => state.commitElement);

  const start = useCallback(
    (screen: Point): boolean => {
      const { selectedTool, viewport } = useEditorStore.getState();
      if (selectedTool === 'select') return false;

      const point = screenToCanvas(screen, viewport);
      setDraft(createDraft(selectedTool, point));
      return true;
    },
    [setDraft],
  );

  const move = useCallback(
    (screen: Point): void => {
      const { draft, viewport } = useEditorStore.getState();
      if (!draft) return;

      const point = screenToCanvas(screen, viewport);
      setDraft(updateDraftGeometry(draft, point));
    },
    [setDraft],
  );

  const end = useCallback((): void => {
    const { draft } = useEditorStore.getState();
    if (!draft) return;

    if (isCommittable(draft)) {
      commitElement(draft);
      // После нарисованной фигуры возвращаемся к выделению — дефолт этапа 1.
      // Lock-тумблер (оставить инструмент активным, как в Excalidraw) — отдельная задача.
      setTool('select');
    }
    setDraft(null);
  }, [commitElement, setDraft, setTool]);

  return { start, move, end };
}
