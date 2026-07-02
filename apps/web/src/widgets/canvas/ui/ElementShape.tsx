import type { KonvaEventObject, Node } from 'konva/lib/Node';
import type { ReactElement } from 'react';
import { Ellipse, Line, Rect } from 'react-konva';

import type { CanvasElement, DraftElement } from '@/entities/canvas-element';
import type { Point } from '@/shared/lib/viewport';

interface ElementShapeProps {
  /** Закоммиченный элемент или черновик-превью — рендерятся одинаково. */
  element: CanvasElement | DraftElement;
  /** Регистрация Konva-узла у родителя — нужна Transformer'у (индикатор выделения). */
  shapeRef?: (node: Node | null) => void;
  /** Нативный Konva draggable. У превью-черновика не задаём — его не таскают. */
  draggable?: boolean;
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
    return { x: node.x() - element.width / 2, y: node.y() - element.height / 2 };
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
  onDragEnd,
}: ElementShapeProps): ReactElement | null {
  // Источник правды о позиции — стор. Синхронизируем ТОЛЬКО на завершение drag
  // (не на каждый кадр): промежуточное движение отрисует сам Konva, а лишние
  // ре-рендеры на dragmove не нужны.
  const handleDragEnd = onDragEnd
    ? (event: KonvaEventObject<DragEvent>): void =>
        onDragEnd(nodePositionToModel(element, event.target))
    : undefined;

  const common = {
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    opacity: element.opacity,
    rotation: element.angle,
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
          width={element.width}
          height={element.height}
          fill={element.fill}
          {...common}
        />
      );

    case 'ellipse':
      // Модель хранит рамку (x/y = угол, width/height), Konva.Ellipse — центр + радиусы.
      return (
        <Ellipse
          ref={shapeRef}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          radiusX={Math.abs(element.width) / 2}
          radiusY={Math.abs(element.height) / 2}
          fill={element.fill}
          {...common}
        />
      );

    case 'line':
      // points относительны x/y — Konva.Line ровно так их и трактует.
      return (
        <Line ref={shapeRef} x={element.x} y={element.y} points={element.points} {...common} />
      );

    default:
      return null;
  }
}
