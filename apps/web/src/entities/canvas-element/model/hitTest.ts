import type { Point } from '@/shared/lib/viewport';

import type { CanvasElement } from './types';

/**
 * Ручной hit-тест «точка попала в фигуру». Живёт в entities как чистая геометрия
 * над доменной моделью (без Konva/DOM), поэтому переиспользуется выделением на
 * холсте и легко тестируется в изоляции.
 *
 * Почему ручной, а не встроенный Konva-hit: пробег O(n) считается ТОЛЬКО на клик
 * (не на кадр), поэтому по цене это дёшево, зато мы не держим у Konva скрытый
 * hit-canvas на каждую фигуру и сами решаем правила попадания (клик внутри
 * незалитой рамки тоже выделяет — как в Excalidraw).
 *
 * tolerance — слабина в координатах холста (обычно экранный паддинг / scale),
 * чтобы по фигуре легче было попасть на мелком зуме.
 */
export function hitTestElement(element: CanvasElement, point: Point, tolerance = 0): boolean {
  switch (element.type) {
    case 'rect': {
      const { width, height } = element.data;
      return isInsideRect(point, element.x, element.y, width, height, tolerance);
    }

    case 'ellipse': {
      const { width, height } = element.data;
      const rx = Math.abs(width) / 2;
      const ry = Math.abs(height) / 2;
      const cx = element.x + width / 2;
      const cy = element.y + height / 2;
      return isInsideEllipse(point, cx, cy, rx, ry, tolerance);
    }

    case 'line':
    case 'arrow':
    case 'freedraw': {
      // Линия, стрелка и freedraw — все тонкие ломаные: попаданием считаем близость к любому
      // сегменту. isNearPolyline уже перебирает ВСЕ сегменты points (не хардкод на две точки),
      // поэтому arrow/freedraw переиспользуют её без изменений — тот же порог = половина
      // толщины + слабина. Наконечник стрелки в hit-test игнорируем — тела достаточно.
      const threshold = tolerance + element.strokeWidth / 2;
      return isNearPolyline(point, element.x, element.y, element.data.points, threshold);
    }

    default:
      return false;
  }
}

function isInsideRect(
  point: Point,
  x: number,
  y: number,
  width: number,
  height: number,
  tolerance: number,
): boolean {
  const minX = Math.min(x, x + width) - tolerance;
  const maxX = Math.max(x, x + width) + tolerance;
  const minY = Math.min(y, y + height) - tolerance;
  const maxY = Math.max(y, y + height) + tolerance;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function isInsideEllipse(
  point: Point,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tolerance: number,
): boolean {
  const radiusX = rx + tolerance;
  const radiusY = ry + tolerance;
  if (radiusX <= 0 || radiusY <= 0) return false;

  // Нормированное уравнение эллипса: точка внутри, если сумма квадратов ≤ 1.
  const nx = (point.x - cx) / radiusX;
  const ny = (point.y - cy) / radiusY;
  return nx * nx + ny * ny <= 1;
}

function isNearPolyline(
  point: Point,
  originX: number,
  originY: number,
  points: number[],
  threshold: number,
): boolean {
  // points относительны origin (x/y элемента) — переводим в мировые координаты.
  // Дефолты ?? 0 удовлетворяют noUncheckedIndexedAccess и безопасны: цикл идёт
  // только по существующим парам (условие i + 3 < length).
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x1 = originX + (points[i] ?? 0);
    const y1 = originY + (points[i + 1] ?? 0);
    const x2 = originX + (points[i + 2] ?? 0);
    const y2 = originY + (points[i + 3] ?? 0);
    if (distanceToSegment(point, x1, y1, x2, y2) <= threshold) return true;
  }
  return false;
}

/** Кратчайшее расстояние от точки до отрезка [(x1,y1),(x2,y2)]. */
function distanceToSegment(point: Point, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - x1, point.y - y1);

  // Проекция точки на прямую, зажатая в границы отрезка [0, 1].
  const t = Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSq));
  return Math.hypot(point.x - (x1 + t * dx), point.y - (y1 + t * dy));
}
