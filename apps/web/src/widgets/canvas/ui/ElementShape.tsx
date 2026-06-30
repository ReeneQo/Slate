import type { ReactElement } from 'react';
import { Ellipse, Line, Rect } from 'react-konva';

import type { CanvasElement, DraftElement } from '@/entities/canvas-element';

interface ElementShapeProps {
  /** Закоммиченный элемент или черновик-превью — рендерятся одинаково. */
  element: CanvasElement | DraftElement;
}

/**
 * Чистый презентационный маппинг доменной модели → Konva-узлы. Не знает про стор:
 * принимает данные пропсом, поэтому переиспользуется и для готовых фигур,
 * и для превью черновика.
 *
 * angle храним в градусах (как rotation у Konva) — отдаём напрямую.
 */
export function ElementShape({ element }: ElementShapeProps): ReactElement | null {
  const common = {
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    opacity: element.opacity,
    rotation: element.angle,
  };

  switch (element.type) {
    case 'rect':
      return (
        <Rect
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
      return <Line x={element.x} y={element.y} points={element.points} {...common} />;

    default:
      return null;
  }
}
