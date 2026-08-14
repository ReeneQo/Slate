import type { Bounds } from '@/entities/canvas-element';
import type { Viewport } from '@/shared/lib/viewport';
import { canvasToScreen } from '@/shared/lib/viewport';

/** Область снятия Konva.toDataURL — screen-координаты Stage (config.x/y/width/height). */
export interface CaptureArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bbox доски (canvas-координаты, из getDocumentBounds) → область снятия для Konva.toDataURL
 * (SLT-66, точка сверки — Подход A). `toDataURL` печёт ТЕКУЩИЙ абсолютный transform узла, до
 * самого Stage (scaleX/scaleY/x/y = viewport), поэтому область задаётся в screen-координатах
 * Stage, не в canvas-координатах документа: screen = world * scale + pan — та же формула, что и
 * `canvasToScreen`. Ширина/высота — тем же коэффициентом scale (canvasToScreen для точки не
 * годится: нужен ещё размер, не только позиция).
 */
export function computeCaptureArea(bounds: Bounds, viewport: Viewport): CaptureArea {
  const topLeft = canvasToScreen({ x: bounds.minX, y: bounds.minY }, viewport);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: (bounds.maxX - bounds.minX) * viewport.scale,
    height: (bounds.maxY - bounds.minY) * viewport.scale,
  };
}
