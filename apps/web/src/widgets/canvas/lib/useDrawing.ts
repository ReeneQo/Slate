import { useCallback, useEffect, useRef } from 'react';

import {
  createDraft,
  type DraftElement,
  FREEDRAW_MIN_DISTANCE,
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

  // Freedraw копит точки через rAF — тот же приём коалессинга, что у useCursorBroadcast (rafId +
  // pending-точка в ref, применяем на следующем кадре, не на каждый mousemove). rect/line этого
  // не делают: там на mousemove не ДОБАВЛЯЕТСЯ точка, а перезаписывается один и тот же конец, и
  // лишний ре-рендер на кадр им не грозит той же ценой, что растущему массиву points.
  const rafId = useRef<number | null>(null);
  const pendingPoint = useRef<Point | null>(null);

  /**
   * Применяет накопленную точку freedraw к черновику. Дистанционный фильтр — здесь, а не в
   * updateDraftGeometry (та осталась чистым append): точка добавляется, только если отошла от
   * ПОСЛЕДНЕЙ УЖЕ ДОБАВЛЕННОЙ дальше FREEDRAW_MIN_DISTANCE — сравнение в canvas-координатах
   * (устойчиво к зуму), не в экранных.
   */
  const flushFreedrawPoint = useCallback((): void => {
    rafId.current = null;
    const point = pendingPoint.current;
    pendingPoint.current = null;
    if (!point) return;

    const { draft } = useEditorStore.getState();
    if (!draft || draft.type !== 'freedraw') return;

    const { points } = draft.data;
    // Дефолты ?? 0 удовлетворяют noUncheckedIndexedAccess и безопасны: createDraft гарантирует
    // минимум одну точку (два числа) в points.
    const lastX = draft.x + (points[points.length - 2] ?? 0);
    const lastY = draft.y + (points[points.length - 1] ?? 0);
    if (Math.hypot(point.x - lastX, point.y - lastY) < FREEDRAW_MIN_DISTANCE) return;

    setDraft(updateDraftGeometry(draft, point));
  }, [setDraft]);

  const start = useCallback(
    (screen: Point): boolean => {
      const { selectedTool, viewport, canEdit } = useEditorStore.getState();
      if (selectedTool === 'select') return false;
      // Роль-гейт (SLT-43): viewer не рисует — тулбар и так скрыт (см. CanvasStage), но обработчик
      // остаётся защищён и от прямого вызова/гонки роли, а не только от отсутствия кнопки в UI.
      if (!canEdit) return false;

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

      if (draft.type === 'freedraw') {
        // Копим сырую точку и коалесим применение через rAF — стор трогаем максимум раз за кадр,
        // а не на каждое из десятков mousemove-событий одного жеста.
        pendingPoint.current = point;
        if (rafId.current === null) {
          rafId.current = requestAnimationFrame(flushFreedrawPoint);
        }
        return;
      }

      setDraft(updateDraftGeometry(draft, point));
    },
    [setDraft, flushFreedrawPoint],
  );

  const end = useCallback((): void => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    // Досрочно применяем точку, накопленную за незавершённый кадр, — иначе последний отрезок
    // жеста (мышь двинулась и тут же отпустили кнопку раньше, чем случился следующий кадр) молча
    // потерялся бы вместе с отменённым rAF.
    flushFreedrawPoint();

    const { draft } = useEditorStore.getState();
    if (!draft) return;

    // Клик карандашом без движения — это не «ничего не рисовать» (в отличие от rect/line/ellipse,
    // где isCommittable отсекает нулевой размер), а точка-клякса: дублируем единственную точку,
    // чтобы Konva.Line из двух совпадающих координат с lineCap="round" отрисовала кружок.
    const finalDraft: DraftElement =
      draft.type === 'freedraw' && draft.data.points.length === 2
        ? { ...draft, data: { points: [...draft.data.points, ...draft.data.points] } }
        : draft;

    if (isCommittable(finalDraft)) {
      commitElement(finalDraft);
      // После нарисованной фигуры возвращаемся к выделению — дефолт этапа 1.
      // Lock-тумблер (оставить инструмент активным, как в Excalidraw) — отдельная задача.
      setTool('select');
    }
    setDraft(null);
  }, [commitElement, setDraft, setTool, flushFreedrawPoint]);

  // Незавершённый rAF не должен пережить размонтирование холста (смена доски/уход с неё) — тот
  // же приём, что у useCursorBroadcast.
  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return { start, move, end };
}
