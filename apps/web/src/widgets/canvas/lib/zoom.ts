import type { Point, Viewport } from '@/shared/lib/viewport';

/** Границы масштаба. min/max подбираются по ощущению. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;

/** Множитель на один «щелчок» колеса мыши. 1.05 = плавно. */
export const ZOOM_SCALE_BY = 1.05;

/**
 * Чувствительность pinch-зума на трекпаде. Подбирается по ощущению:
 * больше — резче. deltaY от pinch мелкий и непрерывный, поэтому
 * масштабируем его экспонентой (см. wheelToZoomFactor).
 */
export const ZOOM_PINCH_SENSITIVITY = 0.01;

export interface ZoomToPointArgs {
  /** Текущая трансформация полотна. */
  viewport: Viewport;
  /** Точка курсора в экранных координатах (относительно Stage). */
  pointer: Point;
  /** Множитель к текущему scale: >1 приблизить, <1 отдалить. */
  factor: number;
  min?: number;
  max?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Превращает событие колеса в множитель зума. Чистая функция — тестируема.
 *
 * Зум геометрический (умножение масштаба), поэтому:
 *  - мышь: дискретный шаг ZOOM_SCALE_BY вверх/вниз;
 *  - трекпад (pinch, ctrlKey=true): непрерывно через exp(-deltaY * s).
 *
 * Почему exp: даёт симметрию (приблизить и отдалить на ту же deltaY —
 * взаимно обратные множители) и корректное накопление при серии событий.
 * Знак единый с мышью: deltaY < 0 → приблизить.
 */
export function wheelToZoomFactor(deltaY: number, isPinch: boolean): number {
  if (isPinch) {
    return Math.exp(-deltaY * ZOOM_PINCH_SENSITIVITY);
  }
  return deltaY < 0 ? ZOOM_SCALE_BY : 1 / ZOOM_SCALE_BY;
}

/**
 * Зум «в точку»: масштабирует полотно так, чтобы мировая точка под курсором
 * осталась под курсором. Чистая функция — без DOM и React, тестируется отдельно.
 *
 * Вывод формулы:
 *   world = (pointer - position) / scale        // точка под курсором сейчас
 *   newPosition = pointer - world * newScale     // чтобы та же точка дала тот же pointer
 *
 * clamp нового масштаба делаем ДО расчёта position, иначе на упёртом лимите
 * точка привязки «поплывёт».
 */
export function zoomToPoint({
  viewport,
  pointer,
  factor,
  min = ZOOM_MIN,
  max = ZOOM_MAX,
}: ZoomToPointArgs): Viewport {
  const { scale, x, y } = viewport;

  const worldX = (pointer.x - x) / scale;
  const worldY = (pointer.y - y) / scale;

  const nextScale = clamp(scale * factor, min, max);

  return {
    scale: nextScale,
    x: pointer.x - worldX * nextScale,
    y: pointer.y - worldY * nextScale,
  };
}
