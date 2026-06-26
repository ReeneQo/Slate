import type { KonvaEventObject } from 'konva/lib/Node';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type Point, type ViewportTransform, wheelToZoomFactor, zoomToPoint } from './zoom';

/** Кнопки мыши в нативном MouseEvent.button. */
const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;

const INITIAL_TRANSFORM: ViewportTransform = { scale: 1, x: 0, y: 0 };

export type CanvasCursor = 'default' | 'grab' | 'grabbing';

export interface CanvasViewportHandlers {
  onWheel: (e: KonvaEventObject<WheelEvent>) => void;
  onMouseDown: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseMove: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseUp: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: (e: KonvaEventObject<MouseEvent>) => void;
}

export interface CanvasViewport {
  transform: ViewportTransform;
  cursor: CanvasCursor;
  handlers: CanvasViewportHandlers;
}

/** Не перехватываем пробел, когда фокус в поле ввода (задел на будущее). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Персональное состояние вьюпорта: масштаб + позиция полотна.
 * Пока локальный useState — стор фигур (Zustand) приедет позже,
 * вьюпорт остаётся персональным состоянием и в общий стор не пойдёт.
 *
 * Pan: пробел+drag ИЛИ средняя кнопка. Левый клик без пробела не трогаем —
 * он зарезервирован под выделение/рисование.
 */
export function useCanvasViewport(): CanvasViewport {
  const [transform, setTransform] = useState<ViewportTransform>(INITIAL_TRANSFORM);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // Последняя позиция указателя в экранных координатах — для расчёта delta при pan.
  // Ref, а не state: меняется на каждый mousemove и не должен триггерить рендер.
  const lastPointer = useRef<Point | null>(null);

  // Отслеживаем пробел на уровне окна: keydown/keyup могут случиться,
  // когда курсор не над Stage. blur сбрасывает залипший пробел при потере фокуса.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || isEditableTarget(e.target)) return;
      e.preventDefault(); // гасим скролл страницы пробелом
      setIsSpacePressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      setIsSpacePressed(false);
    };
    const handleBlur = (): void => {
      setIsSpacePressed(false);
      setIsPanning(false);
      lastPointer.current = null;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const onWheel = useCallback((e: KonvaEventObject<WheelEvent>): void => {
    e.evt.preventDefault(); // не скроллим страницу
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;

    // Pinch на трекпаде приходит как wheel с ctrlKey=true и мелкой deltaY.
    const factor = wheelToZoomFactor(e.evt.deltaY, e.evt.ctrlKey);
    setTransform((prev) => zoomToPoint({ transform: prev, pointer, factor }));
  }, []);

  const onMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>): void => {
      const { button } = e.evt;
      const startsPan = button === MIDDLE_BUTTON || (isSpacePressed && button === LEFT_BUTTON);
      if (!startsPan) return; // левый клик без пробела отдаём дальше

      e.evt.preventDefault(); // гасим автоскролл средней кнопки
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;

      lastPointer.current = pointer;
      setIsPanning(true);
    },
    [isSpacePressed],
  );

  const onMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>): void => {
      if (!isPanning) return;
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer || !lastPointer.current) return;

      // Pan — это сдвиг position на экранную delta. Масштаб тут не участвует:
      // getPointerPosition отдаёт координаты до трансформации Stage.
      const dx = pointer.x - lastPointer.current.x;
      const dy = pointer.y - lastPointer.current.y;
      lastPointer.current = pointer;

      setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    },
    [isPanning],
  );

  const endPan = useCallback((): void => {
    if (!isPanning) return;
    lastPointer.current = null;
    setIsPanning(false);
  }, [isPanning]);

  const cursor: CanvasCursor = isPanning ? 'grabbing' : isSpacePressed ? 'grab' : 'default';

  return {
    transform,
    cursor,
    handlers: {
      onWheel,
      onMouseDown,
      onMouseMove,
      onMouseUp: endPan,
      onMouseLeave: endPan,
    },
  };
}
