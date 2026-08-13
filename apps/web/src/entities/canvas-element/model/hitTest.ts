import { rotatePoint } from '@/shared/lib/angle';
import type { Point } from '@/shared/lib/viewport';

import type { CanvasElement, TextElement } from './types';

/**
 * Пивот поворота элемента (SLT-63) — та же точка, в которой Konva держит нативный rotation-якорь
 * (см. точку сверки SLT-63 и ElementShape.nodePositionToModel): rect/line/freedraw/arrow/text
 * поворачиваются вокруг угла рамки (x, y), ellipse — вокруг центра. Дублирует различие по типу
 * из ElementShape/resize.ts намеренно (hitTest в entities не может импортировать из widgets),
 * но экспортируется для getElementBounds (bounds.ts, тот же слой entities) — там дублировать
 * незачем, оба потребителя сидят в одной model-папке.
 */
export function getRotationPivot(element: CanvasElement): Point {
  if (element.type === 'ellipse') {
    return { x: element.x + element.data.width / 2, y: element.y + element.data.height / 2 };
  }
  return { x: element.x, y: element.y };
}

/**
 * Переводит мировую точку в НЕВРАЩЁННУЮ локальную систему элемента — поворотом на -angle вокруг
 * его пивота (rotatePoint крутит на +angle, тут обратное преобразование). Существующие
 * isInsideRect/isInsideEllipse/isNearPolyline считают геометрию именно в этой системе (без учёта
 * angle), так что после поворота точки их код не меняется.
 */
function unrotatePoint(point: Point, pivot: Point, angle: number): Point {
  return rotatePoint(point, pivot, -angle);
}

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
/**
 * Грубая оценка bbox текста БЕЗ реального измерения (не Konva-нода, не DOM Canvas): line-height
 * коэффициент и средняя ширина символа как доля fontSize. Точность здесь не критична — хитбокс
 * только решает «можно ли попасть кликом», настоящий bbox для Transformer'а даст SLT-62.
 * Независимые от TEXT_LINE_HEIGHT/resolveFontFamily (widgets/canvas/ui/ElementShape.tsx)
 * константы: hitTest живёт в entities и не может импортировать из widgets (FSD — только вниз),
 * а приближение и не обязано совпадать с точным рендером пиксель-в-пиксель.
 */
const TEXT_HIT_LINE_HEIGHT_FACTOR = 1.2;
const TEXT_HIT_CHAR_WIDTH_FACTOR = 0.6;

/**
 * Приближённый локальный (невращённый, от x/y элемента) размер text-фигуры — единственное место
 * с этими коэффициентами (SLT-64: переиспользует getElementBounds в bounds.ts, чтобы bbox текста
 * не считался дважды по двум разным формулам).
 */
export function getTextLocalBounds(element: TextElement): { width: number; height: number } {
  const { text, fontSize } = element.data;
  const lines = text.split('\n');
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    width: longestLine * fontSize * TEXT_HIT_CHAR_WIDTH_FACTOR,
    height: lines.length * fontSize * TEXT_HIT_LINE_HEIGHT_FACTOR,
  };
}

export function hitTestElement(element: CanvasElement, point: Point, tolerance = 0): boolean {
  // Ниже все проверки считают в НЕВРАЩЁННОЙ системе — для повёрнутой фигуры (angle !== 0)
  // переводим точку клика в эту систему один раз, до свитча, остальной код не знает про angle.
  const localPoint =
    element.angle !== 0 ? unrotatePoint(point, getRotationPivot(element), element.angle) : point;

  switch (element.type) {
    case 'rect': {
      const { width, height } = element.data;
      return isInsideRect(localPoint, element.x, element.y, width, height, tolerance);
    }

    case 'ellipse': {
      const { width, height } = element.data;
      const rx = Math.abs(width) / 2;
      const ry = Math.abs(height) / 2;
      const cx = element.x + width / 2;
      const cy = element.y + height / 2;
      return isInsideEllipse(localPoint, cx, cy, rx, ry, tolerance);
    }

    case 'line':
    case 'arrow':
    case 'freedraw': {
      // Линия, стрелка и freedraw — все тонкие ломаные: попаданием считаем близость к любому
      // сегменту. isNearPolyline уже перебирает ВСЕ сегменты points (не хардкод на две точки),
      // поэтому arrow/freedraw переиспользуют её без изменений — тот же порог = половина
      // толщины + слабина. Наконечник стрелки в hit-test игнорируем — тела достаточно.
      const threshold = tolerance + element.strokeWidth / 2;
      return isNearPolyline(localPoint, element.x, element.y, element.data.points, threshold);
    }

    case 'text': {
      // Прямоугольная область, НЕ polyline: text — это content-блок от x/y (левый верхний угол),
      // не ломаная. Пустой текст в hitTest не встречается (isCommittable отсекает коммит пустого).
      const { width, height } = getTextLocalBounds(element);
      return isInsideRect(localPoint, element.x, element.y, width, height, tolerance);
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
