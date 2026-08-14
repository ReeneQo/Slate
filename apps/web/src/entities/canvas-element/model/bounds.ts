import { rotatePoint } from '@/shared/lib/angle';
import type { Point } from '@/shared/lib/viewport';

import { getRotationPivot, getTextLocalBounds } from './hitTest';
import type { CanvasElement } from './types';

/** Axis-aligned bounding box в canvas-координатах. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Осевой (невращённый) bbox элемента — та же геометрия, что и в hitTest, но без учёта angle:
 * rect/ellipse из width/height (для ellipse это её собственная РАМКА, не эллипс — как и у
 * getRotationPivot/hitTest), line/arrow/freedraw — min/max по points (относительны x/y), text —
 * переиспользует getTextLocalBounds (тот же приближённый bbox, что и у hitTest, без второй копии
 * коэффициентов).
 */
function getLocalBounds(element: CanvasElement): Bounds {
  if (element.type === 'rect' || element.type === 'ellipse') {
    const { width, height } = element.data;
    return {
      minX: Math.min(element.x, element.x + width),
      minY: Math.min(element.y, element.y + height),
      maxX: Math.max(element.x, element.x + width),
      maxY: Math.max(element.y, element.y + height),
    };
  }

  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    const { points } = element.data;
    // Дефолты ?? 0 удовлетворяют noUncheckedIndexedAccess — тот же приём, что в hitTest.ts
    // (isNearPolyline): цикл идёт только по существующим парам.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < points.length; i += 2) {
      const px = points[i] ?? 0;
      const py = points[i + 1] ?? 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return {
      minX: element.x + minX,
      minY: element.y + minY,
      maxX: element.x + maxX,
      maxY: element.y + maxY,
    };
  }

  // text
  const { width, height } = getTextLocalBounds(element);
  return { minX: element.x, minY: element.y, maxX: element.x + width, maxY: element.y + height };
}

/**
 * Axis-aligned bbox элемента в мировых координатах, С УЧЁТОМ поворота (SLT-64). Для angle === 0 —
 * быстрый путь, осевой bbox напрямую (без лишней тригонометрии). Иначе: осевой bbox невращённой
 * фигуры → 4 угла поворачиваются на +angle вокруг getRotationPivot (та же точка, что в hitTest) →
 * min/max повёрнутых углов = искомый axis-aligned bbox. Переиспользуемо не только для marquee —
 * общий bbox доски (SLT-66) тоже возьмёт эту функцию.
 */
export function getElementBounds(element: CanvasElement): Bounds {
  const local = getLocalBounds(element);
  if (element.angle === 0) return local;

  const pivot = getRotationPivot(element);
  const corners: Point[] = [
    { x: local.minX, y: local.minY },
    { x: local.maxX, y: local.minY },
    { x: local.maxX, y: local.maxY },
    { x: local.minX, y: local.maxY },
  ].map((corner) => rotatePoint(corner, pivot, element.angle));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x;
    if (corner.x > maxX) maxX = corner.x;
    if (corner.y < minY) minY = corner.y;
    if (corner.y > maxY) maxY = corner.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * AABB-пересечение (не containment, Р2/В2=A задачи SLT-64): true, если рамка marquee и bbox
 * элемента имеют хотя бы одну общую точку, включая касание по границе.
 */
export function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/**
 * Отступ вокруг bbox всей доски при экспорте (SLT-66), в canvas-координатах: страхует от обрезки
 * геометрии, вылезающей за axis-aligned bbox — strokeWidth на границе фигуры, наконечники arrow,
 * tension у линий. Константа, не параметр — единый вид у всех экспортов.
 */
export const EXPORT_PADDING = 24;

/**
 * Bbox ВСЕЙ доски (SLT-66) — объединение getElementBounds по всем элементам + EXPORT_PADDING со
 * всех сторон. Пустой документ → null (сигнал «нечего экспортировать» для вызывающего, не
 * бросаем на пустом min/max).
 */
export function getDocumentBounds(elements: CanvasElement[]): Bounds | null {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const bounds = getElementBounds(element);
    if (bounds.minX < minX) minX = bounds.minX;
    if (bounds.minY < minY) minY = bounds.minY;
    if (bounds.maxX > maxX) maxX = bounds.maxX;
    if (bounds.maxY > maxY) maxY = bounds.maxY;
  }

  return {
    minX: minX - EXPORT_PADDING,
    minY: minY - EXPORT_PADDING,
    maxX: maxX + EXPORT_PADDING,
    maxY: maxY + EXPORT_PADDING,
  };
}
