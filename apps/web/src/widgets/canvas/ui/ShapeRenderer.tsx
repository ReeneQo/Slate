import type { ReactElement } from 'react';

import { useDocumentStore } from '@/entities/canvas-element';

import { ElementShape } from './ElementShape';

interface ShapeRendererProps {
  id: string;
}

/**
 * Стор-подключённая обёртка над одной фигурой. Подписана ТОЛЬКО на свой элемент
 * по id, поэтому апдейт элемента X перерендерит лишь shape X, а не весь слой —
 * это важно для будущих точечных апдейтов (драг, реалтайм).
 */
export function ShapeRenderer({ id }: ShapeRendererProps): ReactElement | null {
  const element = useDocumentStore((state) => state.elements[id]);
  if (!element) return null;

  return <ElementShape element={element} />;
}
