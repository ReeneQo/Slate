import type { Node } from 'konva/lib/Node';
import type { ReactElement } from 'react';

import { useDocumentStore } from '@/entities/canvas-element';

import { ElementShape } from './ElementShape';

interface ShapeRendererProps {
  id: string;
  /** Регистрация Konva-узла у родителя — нужна Transformer'у (индикатор выделения). */
  shapeRef: (node: Node | null) => void;
  /** Можно ли тащить фигуру (нативный Konva draggable). Считает CanvasStage. */
  draggable: boolean;
  /** Текущий зум — для scale-зависимой ширины зоны захвата (см. ElementShape). */
  scale: number;
}

/**
 * Стор-подключённая обёртка над одной фигурой. Подписана ТОЛЬКО на свой элемент
 * по id, поэтому апдейт элемента X перерендерит лишь shape X, а не весь слой —
 * это важно для точечных апдейтов (drag, будущий реалтайм). Именно эта реактивная
 * подписка (а не getState) гарантирует: после onDragEnd render узла и стор совпадут.
 */
export function ShapeRenderer({
  id,
  shapeRef,
  draggable,
  scale,
}: ShapeRendererProps): ReactElement | null {
  const element = useDocumentStore((state) => state.elements[id]);
  const updateElement = useDocumentStore((state) => state.updateElement);
  if (!element) return null;

  return (
    <ElementShape
      element={element}
      shapeRef={shapeRef}
      draggable={draggable}
      scale={scale}
      // Координаты относительные — при переносе меняются только x/y, геометрия та же.
      onDragEnd={(position) => updateElement(id, position)}
    />
  );
}
