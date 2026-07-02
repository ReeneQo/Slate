import type { KonvaEventObject, Node } from 'konva/lib/Node';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Point } from '@/shared/lib/viewport';

import { useEditorStore } from '../model/editor.store';
import { useDrawing } from './useDrawing';
import { useSelection } from './useSelection';
import { wheelToZoomFactor, zoomToPoint } from './zoom';

/** Кнопки мыши в нативном MouseEvent.button. */
const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;

export type CanvasCursor = 'default' | 'grab' | 'grabbing' | 'crosshair' | 'move';

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

export interface CanvasInteractionOptions {
  /** Доступ к Konva-узлу по id — оркестратор программно стартует его drag. */
  getNode: (id: string) => Node | null;
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
 * Drag фигуры стартуем программно (node.startDrag()) по ручному hit-тесту, а не
 * через нативный draggable Konva. Причина: hit-тест у нас щедрый (с паддингом, и
 * тем же, что рисует курсор «move»), а точечный hit узла Konva — нет. Единая
 * система попадания = drag срабатывает везде, где показан курсор перетаскивания.
 *
 * Вьюпорт читаем/пишем через стор (а не локальный useState): он нужен и рисованию
 * для screen→canvas, поэтому это общее состояние редактора.
 */
export function useCanvasInteraction({ getNode }: CanvasInteractionOptions): CanvasInteraction {
  const drawing = useDrawing();
  const { selectAt, findAt } = useSelection();
  const setViewport = useEditorStore((state) => state.setViewport);
  const selectedTool = useEditorStore((state) => state.selectedTool);

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  // Наведён ли курсор на фигуру в select-режиме — для курсора «move».
  const [isHoveringShape, setIsHoveringShape] = useState(false);

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

      if (button !== LEFT_BUTTON) return;

      // Select-режим: клик = выделение, и сразу программно стартуем drag узла по
      // тому же hit-тесту. startDrag берёт offset из текущего указателя (mousedown
      // его уже выставил), поэтому фигура не прыгает; дальше DND ведёт Konva, а
      // позицию в стор коммитит onDragEnd. Пустой клик (null) — просто снятие.
      if (selectedTool === 'select') {
        const hitId = selectAt(pointer);
        if (hitId) getNode(hitId)?.startDrag();
        return;
      }

      drawing.start(pointer);
    },
    [isSpacePressed, selectedTool, selectAt, getNode, drawing],
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

      // Select-режим: подсвечиваем курсором фигуру под указателем (её можно тащить).
      // findAt дёшев (O(n) на кадр без hit-canvas), а setState тем же значением
      // React гасит без ре-рендера — курсор меняется только на границе фигуры.
      if (selectedTool === 'select') {
        setIsHoveringShape(findAt(pointer) !== null);
        return;
      }

      drawing.move(pointer);
    },
    [isPanning, selectedTool, findAt, drawing, setViewport],
  );

  const endInteraction = useCallback((): void => {
    if (isPanning) {
      lastPointer.current = null;
      setIsPanning(false);
    }
    drawing.end();
  }, [isPanning, drawing]);

  // Уводя курсор со Stage, завершаем жест И гасим hover — иначе «move» залипнет.
  const onMouseLeave = useCallback((): void => {
    endInteraction();
    setIsHoveringShape(false);
  }, [endInteraction]);

  const cursor: CanvasCursor = isPanning
    ? 'grabbing'
    : isSpacePressed
      ? 'grab'
      : selectedTool !== 'select'
        ? 'crosshair'
        : isHoveringShape
          ? 'move'
          : 'default';

  return {
    cursor,
    handlers: {
      onWheel,
      onMouseDown,
      onMouseMove,
      onMouseUp: endInteraction,
      onMouseLeave,
    },
  };
}
