import type { KonvaEventObject, Node } from 'konva/lib/Node';
import type { ReactElement } from 'react';
import { Ellipse, Line, Rect } from 'react-konva';

import type { CanvasElement, DraftElement } from '@/entities/canvas-element';
import type { Point } from '@/shared/lib/viewport';

import { HIT_PADDING_PX } from '../lib/useSelection';

/**
 * Сглаживание ломаной freedraw через Konva-кривую по контрольным точкам. НЕ perfect-freehand
 * (переменная толщина по нажиму/скорости) — отдельная будущая задача; сейчас это чисто
 * визуальная примочка поверх той же полилинии, что и у line.
 */
const FREEDRAW_TENSION = 0.4;

interface ElementShapeProps {
  /** Закоммиченный элемент или черновик-превью — рендерятся одинаково. */
  element: CanvasElement | DraftElement;
  /** Регистрация Konva-узла у родителя — нужна Transformer'у (индикатор выделения). */
  shapeRef?: (node: Node | null) => void;
  /** Нативный Konva draggable. У превью-черновика не задаём — его не таскают. */
  draggable?: boolean;
  /** Текущий зум — чтобы зона захвата держала постоянную ширину в экранных px. */
  scale: number;
  /** Коммит новой позиции в стор. Отдаём УЖЕ в координатах модели (x/y = угол рамки). */
  onDragEnd?: (position: Point) => void;
}

/**
 * Позиция Konva-узла → координаты модели (левый верхний угол рамки).
 * Маппинг обратен рендеру ниже и живёт здесь же — единственное место, где мы
 * знаем, что для эллипса узел стоит в ЦЕНТРЕ (x + w/2), а для rect/line в углу.
 * Так после drag стор и узел совпадут, и фигура не «прыгнет назад».
 */
function nodePositionToModel(element: ElementShapeProps['element'], node: Node): Point {
  if (element.type === 'ellipse') {
    return { x: node.x() - element.data.width / 2, y: node.y() - element.data.height / 2 };
  }
  return { x: node.x(), y: node.y() };
}

/**
 * Чистый презентационный маппинг доменной модели → Konva-узлы. Не знает про стор:
 * принимает данные пропсом, поэтому переиспользуется и для готовых фигур,
 * и для превью черновика.
 *
 * angle храним в градусах (как rotation у Konva) — отдаём напрямую.
 */
export function ElementShape({
  element,
  shapeRef,
  draggable,
  scale,
  onDragEnd,
}: ElementShapeProps): ReactElement | null {
  // Источник правды о позиции — стор. Синхронизируем ТОЛЬКО на завершение drag
  // (не на каждый кадр): промежуточное движение отрисует сам Konva, а лишние
  // ре-рендеры на dragmove не нужны.
  const handleDragEnd = onDragEnd
    ? (event: KonvaEventObject<DragEvent>): void =>
        onDragEnd(nodePositionToModel(element, event.target))
    : undefined;

  // Зона ЗАХВАТА нативного drag должна совпадать с зоной КУРСОРА «move» — её рисует
  // ручной hitTestElement с tolerance = HIT_PADDING_PX/scale. hitStrokeWidth задаёт
  // ПОЛНУЮ ширину hit-штриха (полоса hitStrokeWidth/2 в каждую сторону), поэтому
  // берём удвоенный tolerance. Для линии hitTestElement добавляет ещё strokeWidth/2
  // (порог = tolerance + strokeWidth/2) — добавляем и здесь, иначе на линии остаётся
  // ровно один неберущийся пиксель. Делим на scale: полоса держит постоянную ширину
  // в экранных px при любом зуме — как и курсор.
  const tolerance = HIT_PADDING_PX / scale;
  const hitStrokeWidth =
    element.type === 'line' || element.type === 'freedraw'
      ? 2 * tolerance + element.strokeWidth
      : 2 * tolerance;

  const common = {
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    opacity: element.opacity,
    rotation: element.angle,
    // Сервер отдаёт fill как string | null (null — фигура без заливки). Konva ждёт
    // string | undefined, поэтому null приводим к undefined — «заливки нет».
    fill: element.fill ?? undefined,
    hitStrokeWidth,
    draggable,
    onDragEnd: handleDragEnd,
  };

  switch (element.type) {
    case 'rect':
      return (
        <Rect
          ref={shapeRef}
          x={element.x}
          y={element.y}
          width={element.data.width}
          height={element.data.height}
          {...common}
        />
      );

    case 'ellipse':
      // Модель хранит рамку (x/y = угол, width/height), Konva.Ellipse — центр + радиусы.
      return (
        <Ellipse
          ref={shapeRef}
          x={element.x + element.data.width / 2}
          y={element.y + element.data.height / 2}
          radiusX={Math.abs(element.data.width) / 2}
          radiusY={Math.abs(element.data.height) / 2}
          {...common}
        />
      );

    case 'line':
      // points относительны x/y — Konva.Line ровно так их и трактует.
      return (
        <Line ref={shapeRef} x={element.x} y={element.y} points={element.data.points} {...common} />
      );

    case 'freedraw':
      // Та же геометрия, что у line (points относительны x/y), плюс tension/lineCap/lineJoin —
      // сглаживают ломаную под рукописный штрих. closed/fill не задаём: freedraw — контур, не
      // область. Точка-клякса (points из двух совпадающих координат, см. useDrawing) рисуется
      // тем же Line: tension на паре одинаковых точек не ломает рендер, lineCap="round" даёт круг.
      return (
        <Line
          ref={shapeRef}
          x={element.x}
          y={element.y}
          points={element.data.points}
          tension={FREEDRAW_TENSION}
          lineCap="round"
          lineJoin="round"
          {...common}
        />
      );

    default:
      return null;
  }
}
