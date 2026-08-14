import Konva from 'konva';

import type { Bounds } from '@/entities/canvas-element';
import type { Viewport } from '@/shared/lib/viewport';

import { computeCaptureArea } from './captureArea';
import { computeEffectivePixelRatio } from './pixelRatio';

export interface ExportBoardPngParams {
  /** Основной Layer (фигуры + Transformer) — НЕ Stage: так курsоры (отдельный listening=false
   * Layer) физически не участвуют в вызове (SLT-66, точка сверки, решение 2). */
  layer: Konva.Layer;
  /** bbox доски + padding (getDocumentBounds), canvas-координаты. */
  bounds: Bounds;
  viewport: Viewport;
  /** Transformer основного слоя — на время снятия прячем рамку выделения (та же логика, что и
   * исключение курсоров: UI-оверлей выделения не часть документа и не должен попасть в PNG). */
  transformer: Konva.Transformer | null;
}

/**
 * Снимает PNG всей доски (SLT-66, Подход A) — область в screen-координатах Stage
 * (computeCaptureArea), pixelRatio скомпенсирован текущим зумом (computeEffectivePixelRatio).
 *
 * Белый фон — временный Konva.Rect, добавленный НАПРЯМУЮ в Layer (императивно, не через React
 * state, решение 4): кладём под все фигуры (`moveToBottom`), снимаем `toDataURL` синхронно,
 * убираем (`destroy`) в finally — так временный узел не переживает ни одного лишнего кадра и не
 * плодит React-рендер ради разового снимка.
 */
export function exportBoardPng({
  layer,
  bounds,
  viewport,
  transformer,
}: ExportBoardPngParams): string {
  const area = computeCaptureArea(bounds, viewport);
  const pixelRatio = computeEffectivePixelRatio(viewport.scale);

  const background = new Konva.Rect({
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    fill: '#ffffff',
    listening: false,
  });
  layer.add(background);
  background.moveToBottom();

  const wasTransformerVisible = transformer?.visible() ?? false;
  transformer?.visible(false);

  try {
    return layer.toDataURL({ ...area, pixelRatio });
  } finally {
    background.destroy();
    transformer?.visible(wasTransformerVisible);
    layer.batchDraw();
  }
}
