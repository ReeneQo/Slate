import type { KonvaEventObject } from 'konva/lib/Node';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Point } from '@/shared/lib/viewport';

import { useEditorStore } from '../model/editor.store';
import { useDrawing } from './useDrawing';
import { wheelToZoomFactor, zoomToPoint } from './zoom';

/** Кнопки мыши в нативном MouseEvent.button. */
const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;

export type CanvasCursor = 'default' | 'grab' | 'grabbing' | 'crosshair';

export interface CanvasInteractionHandlers {
  onWheel: (e: KonvaEventObject<WheelEvent>) => void;
  onMouseDown: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseMove: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseUp: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: (e: KonvaEventObject<MouseEvent>) => void;
}

export interface CanvasInteraction {
  cursor: CanvasCursor;
  handlers: CanvasInteractionHandlers;
}

/** Не перехватываем пробел, когда фокус в поле ввода (задел на будущее). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Единый оркестратор указательного ввода на холсте. Сводит два независимых
 * сценария на одни и те же события Stage:
 *  - pan/zoom вьюпорта (пробел+drag / средняя кнопка / колесо) — пишет в editor-стор;
 *  - рисование клик-драгом (левая кнопка + инструмент) — через useDrawing.
 *
 * Маршрутизация в одном месте, чтобы жесты не конфликтовали: pan имеет приоритет
 * над рисованием (зажат пробел — тащим полотно, не рисуем).
 *
 * Вьюпорт читаем/пишем через стор (а не локальный useState): он нужен и рисованию
 * для screen→canvas, поэтому это общее состояние редактора.
 */
export function useCanvasInteraction(): CanvasInteraction {
  const drawing = useDrawing();
  const setViewport = useEditorStore((state) => state.setViewport);
  const selectedTool = useEditorStore((state) => state.selectedTool);

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // Последняя позиция указателя (экранные координаты) — для расчёта delta при pan.
  // Ref, а не state: меняется на каждый mousemove и не должен триггерить рендер.
  const lastPointer = useRef<Point | null>(null);

  // Пробел отслеживаем на уровне окна: keydown/keyup могут случиться вне Stage.
  // blur сбрасывает «залипший» пробел и pan при потере фокуса окна.
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

  const onWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>): void => {
      e.evt.preventDefault(); // не скроллим страницу
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;

      // Pinch на трекпаде приходит как wheel с ctrlKey=true и мелкой deltaY.
      const factor = wheelToZoomFactor(e.evt.deltaY, e.evt.ctrlKey);
      const { viewport } = useEditorStore.getState();
      setViewport(zoomToPoint({ viewport, pointer, factor }));
    },
    [setViewport],
  );

  const onMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>): void => {
      const { button } = e.evt;
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;

      const startsPan = button === MIDDLE_BUTTON || (isSpacePressed && button === LEFT_BUTTON);
      if (startsPan) {
        e.evt.preventDefault(); // гасим автоскролл средней кнопки
        lastPointer.current = pointer;
        setIsPanning(true);
        return; // pan приоритетнее рисования
      }

      if (button === LEFT_BUTTON) drawing.start(pointer);
    },
    [isSpacePressed, drawing],
  );

  const onMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>): void => {
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;

      if (isPanning && lastPointer.current) {
        // Pan — сдвиг position на экранную delta (масштаб тут не участвует:
        // getPointerPosition отдаёт координаты до трансформации Stage).
        const dx = pointer.x - lastPointer.current.x;
        const dy = pointer.y - lastPointer.current.y;
        lastPointer.current = pointer;

        const { viewport } = useEditorStore.getState();
        setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
        return;
      }

      drawing.move(pointer);
    },
    [isPanning, drawing, setViewport],
  );

  const endInteraction = useCallback((): void => {
    if (isPanning) {
      lastPointer.current = null;
      setIsPanning(false);
    }
    drawing.end();
  }, [isPanning, drawing]);

  const cursor: CanvasCursor = isPanning
    ? 'grabbing'
    : isSpacePressed
      ? 'grab'
      : selectedTool !== 'select'
        ? 'crosshair'
        : 'default';

  return {
    cursor,
    handlers: {
      onWheel,
      onMouseDown,
      onMouseMove,
      onMouseUp: endInteraction,
      onMouseLeave: endInteraction,
    },
  };
}
