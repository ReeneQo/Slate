import { useCallback, useRef } from 'react';

import { getElementBounds, rectsIntersect, useDocumentStore } from '@/entities/canvas-element';
import { type Point, screenToCanvas } from '@/shared/lib/viewport';

import { useEditorStore } from '../model/editor.store';

/**
 * Минимальный размер marquee-рамки (canvas-координаты), ниже которого жест считаем случайным
 * кликом, а не тягой рамки — тот же принцип, что и MIN_COMMIT_SIZE у черновика фигуры
 * (entities/canvas-element/model/element.ts), но отдельная константа: это UI-жест выделения,
 * не геометрия фигуры, порог им незачем шарить.
 */
const MIN_MARQUEE_SIZE = 3;

export interface MarqueeController {
  /** mousedown по пустому месту в select-режиме — запоминает старт-точку рамки. */
  start: (screen: Point) => void;
  /** mousemove во время тяги — обновляет marqueeRect в сторе (нормализованный, любое направление). */
  move: (screen: Point) => void;
  /**
   * mouseup/mouseleave — завершает жест. Рамка меньше MIN_MARQUEE_SIZE — это был клик, а не тяга:
   * выделение уже снято в onMouseDown (selectAt на пустом месте), здесь просто гасим marqueeRect.
   * Иначе — пересечение (Р2/В2=A, не containment) bbox каждого элемента с рамкой → setSelectedElementIds.
   * No-op, если marquee не был начат (marqueeRect === null) — безопасно звать всегда, как drawing.end().
   */
  end: () => void;
}

function normalizeRect(
  start: Point,
  current: Point,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function useMarquee(): MarqueeController {
  const setMarqueeRect = useEditorStore((state) => state.setMarqueeRect);
  const setSelectedElementIds = useEditorStore((state) => state.setSelectedElementIds);

  // Старт-точка в canvas-координатах — не в сторе (эфемерна на кадр жеста, не нужна реактивность).
  const startPoint = useRef<Point | null>(null);

  const start = useCallback(
    (screen: Point): void => {
      const { viewport } = useEditorStore.getState();
      const point = screenToCanvas(screen, viewport);
      startPoint.current = point;
      setMarqueeRect({ x: point.x, y: point.y, width: 0, height: 0 });
    },
    [setMarqueeRect],
  );

  const move = useCallback(
    (screen: Point): void => {
      const start = startPoint.current;
      if (!start) return;

      const { viewport } = useEditorStore.getState();
      const point = screenToCanvas(screen, viewport);
      setMarqueeRect(normalizeRect(start, point));
    },
    [setMarqueeRect],
  );

  const end = useCallback((): void => {
    const rect = useEditorStore.getState().marqueeRect;
    startPoint.current = null;
    setMarqueeRect(null);
    if (!rect) return;

    // Слишком маленькая рамка — это был клик по пустому месту, не тяга. selectAt уже снял
    // выделение на mousedown (id === null, без shift) — здесь ничего досчитывать не нужно.
    if (rect.width < MIN_MARQUEE_SIZE || rect.height < MIN_MARQUEE_SIZE) return;

    const marqueeBounds = {
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
    };

    const { elements, elementIds } = useDocumentStore.getState();
    const matched = elementIds.filter((id) => {
      const element = elements[id];
      return element !== undefined && rectsIntersect(marqueeBounds, getElementBounds(element));
    });
    setSelectedElementIds(matched);
  }, [setMarqueeRect, setSelectedElementIds]);

  return { start, move, end };
}
