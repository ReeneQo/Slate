import type { KonvaEventObject, Node } from 'konva/lib/Node';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { useDocumentStore } from '@/entities/canvas-element';
import { isEditableTarget } from '@/shared/lib/dom';
import type { Point } from '@/shared/lib/viewport';

import { useEditorStore } from '../model/editor.store';
import { useDrawing } from './useDrawing';
import { useGroupDrag } from './useGroupDrag';
import { useMarquee } from './useMarquee';
import { useSelection } from './useSelection';
import { wheelToZoomFactor, zoomToPoint } from './zoom';

/** Кнопки мыши в нативном MouseEvent.button. */
const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;

export type CanvasCursor = 'default' | 'grab' | 'grabbing' | 'crosshair' | 'move';

// isEditableTarget вынесен в @/shared/lib/dom — общий guard для всех
// клавиатурных обработчиков холста (пробел здесь, Delete в useCanvasHotkeys).

export interface CanvasInteractionHandlers {
  onWheel: (e: KonvaEventObject<WheelEvent>) => void;
  onMouseDown: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseMove: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseUp: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseLeave: (e: KonvaEventObject<MouseEvent>) => void;
  // Всплывают со Stage при нативном drag узла-фигуры (Stage сам не draggable).
  onDragStart: (e: KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
  /** Ре-редактирование существующего text-элемента (SLT-61, Р6) — открывает оверлей на нём. */
  onDblClick: (e: KonvaEventObject<MouseEvent>) => void;
}

export interface CanvasInteraction {
  cursor: CanvasCursor;
  handlers: CanvasInteractionHandlers;
  /**
   * Активен ли pan-режим (зажат пробел или идёт панорама). Наружу — чтобы холст
   * отключал draggable узлов в pan (иначе тащилась бы фигура вместо полотна).
   */
  isPanMode: boolean;
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
 * Drag фигуры ведёт НАТИВНЫЙ Konva draggable на самом узле (см. ElementShape), а не
 * программный startDrag отсюда: Konva сама разводит клик от перетаскивания по
 * встроенному порогу смещения, поэтому клик только выделяет, а тащит лишь
 * удержание+движение. Здесь select-ветка onMouseDown лишь выделяет (selectAt).
 * draggable включаем только в select-режиме вне pan — этот признак отдаём наружу
 * (isPanMode), CanvasStage считает по нему draggable узлов.
 *
 * Вьюпорт читаем/пишем через стор (а не локальный useState): он нужен и рисованию
 * для screen→canvas, поэтому это общее состояние редактора.
 *
 * nodeMap (SLT-64) — реестр живых Konva-узлов по id, заведённый в CanvasStage (нужен Transformer'у
 * для .nodes()) и прокинутый сюда: group-drag (useGroupDrag) им же ищет узел ведущего/сиблингов по
 * bubbled drag-событию, отдельного реестра заводить незачем.
 */
export function useCanvasInteraction(nodeMap: RefObject<Map<string, Node>>): CanvasInteraction {
  const drawing = useDrawing();
  const { selectAt, findAt } = useSelection();
  const marquee = useMarquee();
  const groupDrag = useGroupDrag(nodeMap);
  const setViewport = useEditorStore((state) => state.setViewport);
  const selectedTool = useEditorStore((state) => state.selectedTool);
  const setEditingTextId = useEditorStore((state) => state.setEditingTextId);

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  // Наведён ли курсор на фигуру в select-режиме — для курсора «move».
  const [isHoveringShape, setIsHoveringShape] = useState(false);
  // Идёт ли нативный drag фигуры — чтобы держать курсор «move» весь жест, а не
  // только в момент захвата (findAt смотрит на позиции в сторе, а они меняются
  // лишь на onDragEnd, поэтому по ходу драга hover-курсор бы слетал).
  const [isDraggingShape, setIsDraggingShape] = useState(false);

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

      // Select-режим: клик ТОЛЬКО выделяет (+ shift — toggle, SLT-64). Сам drag ведёт нативный
      // draggable узла (Konva разводит клик от перетаскивания порогом смещения) — программный
      // startDrag убран, из-за него фигура липла к курсору без удержания кнопки. Позицию в стор
      // коммитит onDragEnd. Пустой клик БЕЗ shift (id === null) — снимает выделение и, поскольку
      // это ещё и потенциальное начало тяги, стартует marquee (решится на mouseup — реальная тяга
      // или просто клик, см. useMarquee.end и MIN_MARQUEE_SIZE). Пустой клик С shift — no-op,
      // marquee по решению точки сверки shift игнорирует.
      if (selectedTool === 'select') {
        const id = selectAt(pointer, e.evt.shiftKey);
        if (id === null && !e.evt.shiftKey) marquee.start(pointer);
        return;
      }

      drawing.start(pointer);
    },
    [isSpacePressed, selectedTool, selectAt, marquee, drawing],
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

      // Select-режим: если тянем marquee (стартовала на mousedown по пустому месту) — обновляем
      // рамку, а не hover-курсор (наведение на фигуру ПОД тянущейся рамкой сейчас не при чём).
      // Иначе — подсвечиваем курсором фигуру под указателем (её можно тащить). findAt дёшев
      // (O(n) на кадр без hit-canvas), а setState тем же значением React гасит без ре-рендера —
      // курсор меняется только на границе фигуры.
      if (selectedTool === 'select') {
        if (useEditorStore.getState().marqueeRect !== null) {
          marquee.move(pointer);
          return;
        }
        setIsHoveringShape(findAt(pointer) !== null);
        return;
      }

      drawing.move(pointer);
    },
    [isPanning, selectedTool, findAt, marquee, drawing, setViewport],
  );

  const endInteraction = useCallback((): void => {
    if (isPanning) {
      lastPointer.current = null;
      setIsPanning(false);
    }
    drawing.end();
    // No-op, если marquee не начат (marqueeRect уже null) — безопасно звать всегда, как drawing.end().
    marquee.end();
  }, [isPanning, drawing, marquee]);

  // Уводя курсор со Stage, завершаем жест И гасим hover — иначе «move» залипнет.
  const onMouseLeave = useCallback((): void => {
    endInteraction();
    setIsHoveringShape(false);
  }, [endInteraction]);

  // Drag узла-фигуры (нативный Konva) всплывает до Stage — держим по нему «move» на весь жест,
  // независимо от hover-теста. groupDrag (SLT-64) слушает те же bubbled события: если тащат узел
  // из multi-выделения, синхронизирует остальные выделенные узлы на ту же дельту (Вариант B, см.
  // useGroupDrag) — для одиночного drag это no-op (activeDrag не заводится, см. её докстринг).
  const onDragStart = useCallback(
    (e: KonvaEventObject<DragEvent>): void => {
      setIsDraggingShape(true);
      // Параллельно локальному state (SLT-65) — editor-стор нужен гварду undo/redo/delete хоткеев,
      // который не подписан на этот хук и читает жест через getState() (см. editor.store).
      useEditorStore.getState().setDraggingElement(true);
      groupDrag.onDragStart(e);
    },
    [groupDrag],
  );
  const onDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>): void => {
      groupDrag.onDragMove(e);
    },
    [groupDrag],
  );
  const onDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>): void => {
      setIsDraggingShape(false);
      useEditorStore.getState().setDraggingElement(false);
      groupDrag.onDragEnd(e);
    },
    [groupDrag],
  );

  // Ре-редактирование text по dblclick (SLT-61, Р6). findAt — тот же hit-test, что у selectAt
  // (единый источник «что под курсором»), просто без побочного эффекта выделения.
  const onDblClick = useCallback(
    (e: KonvaEventObject<MouseEvent>): void => {
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;

      const { canEdit, draft, editingTextId } = useEditorStore.getState();
      if (!canEdit) return;
      // Оверлей уже открыт (создание ИЛИ ре-редактирование другого текста) — второй не открываем,
      // тот же guard, что и в useDrawing.start.
      if ((draft && draft.type === 'text') || editingTextId !== null) return;

      const id = findAt(pointer);
      if (!id) return;

      const { elements } = useDocumentStore.getState();
      const element = elements[id];
      if (!element || element.type !== 'text') return;

      setEditingTextId(id);
    },
    [findAt, setEditingTextId],
  );

  const cursor: CanvasCursor = isPanning
    ? 'grabbing'
    : isDraggingShape
      ? 'move' // тащим фигуру — «move» весь жест, приоритетнее hover/пробела
      : isSpacePressed
        ? 'grab'
        : selectedTool !== 'select'
          ? 'crosshair'
          : isHoveringShape
            ? 'move'
            : 'default';

  // Pan-намерение: зажат пробел (готовность тащить полотно) или уже идёт панорама.
  // По нему холст гасит draggable фигур, чтобы в pan ехало полотно, а не фигура.
  const isPanMode = isSpacePressed || isPanning;

  return {
    cursor,
    isPanMode,
    handlers: {
      onWheel,
      onMouseDown,
      onMouseMove,
      onMouseUp: endInteraction,
      onMouseLeave,
      onDragStart,
      onDragMove,
      onDragEnd,
      onDblClick,
    },
  };
}
