/**
 * Целевая чёткость экспорта (SLT-66) — ~2 растровых пикселя на canvas-единицу при масштабе 100%
 * (viewport.scale = 1). Konva.toDataURL печёт ТЕКУЩИЙ scale Stage в результат (полный abs-transform
 * узла, до самого Stage — см. точку сверки), поэтому голый pixelRatio=2 давал бы разрешение,
 * плавающее от того, насколько юзер сейчас зумнут. Компенсируем: effectivePixelRatio =
 * EXPORT_PIXEL_RATIO / scale.
 */
export const EXPORT_PIXEL_RATIO = 2;

/**
 * Клампы компенсированного pixelRatio. Без них при сильном отзуме (scale → 0) EXPORT_PIXEL_RATIO /
 * scale уходит в огромное число — гигантский canvas, риск памяти/размера файла. При сильном
 * приближении (scale большой) компенсация ушла бы ниже 1 — размытие ниже разумного пола.
 * Диапазон [1, 4]: 1 — не хуже честного 1:1 растра, 4 — вчетверо избыточно, но конечно.
 */
export const MIN_EXPORT_PIXEL_RATIO = 1;
export const MAX_EXPORT_PIXEL_RATIO = 4;

/**
 * pixelRatio для Konva.toDataURL, скомпенсированный текущим зумом холста (SLT-66) — см. докстринг
 * EXPORT_PIXEL_RATIO. Зажат в [MIN_EXPORT_PIXEL_RATIO, MAX_EXPORT_PIXEL_RATIO].
 */
export function computeEffectivePixelRatio(scale: number): number {
  const raw = EXPORT_PIXEL_RATIO / scale;
  return Math.min(MAX_EXPORT_PIXEL_RATIO, Math.max(MIN_EXPORT_PIXEL_RATIO, raw));
}
