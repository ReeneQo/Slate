import { describe, expect, it } from 'vitest';

import type { Point, Viewport } from '@/shared/lib/viewport';

import { wheelToZoomFactor, ZOOM_MAX, ZOOM_MIN, ZOOM_SCALE_BY, zoomToPoint } from './zoom';

/**
 * Мировая точка под курсором: world = (pointer - position) / scale.
 * Главный инвариант зума «в точку» — это значение не должно меняться.
 */
function worldUnderPointer(viewport: Viewport, pointer: Point): Point {
  return {
    x: (pointer.x - viewport.x) / viewport.scale,
    y: (pointer.y - viewport.y) / viewport.scale,
  };
}

describe('zoomToPoint', () => {
  it('умножает scale на factor', () => {
    const viewport: Viewport = { scale: 1, x: 0, y: 0 };
    const result = zoomToPoint({
      viewport,
      pointer: { x: 100, y: 100 },
      factor: 2,
    });

    expect(result.scale).toBe(2);
  });

  it('сохраняет мировую точку под курсором (identity transform)', () => {
    const viewport: Viewport = { scale: 1, x: 0, y: 0 };
    const pointer: Point = { x: 300, y: 200 };

    const before = worldUnderPointer(viewport, pointer);
    const after = worldUnderPointer(
      zoomToPoint({ viewport, pointer, factor: ZOOM_SCALE_BY }),
      pointer,
    );

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('сохраняет мировую точку при уже смещённом и масштабированном полотне', () => {
    const viewport: Viewport = { scale: 1.7, x: -240, y: 130 };
    const pointer: Point = { x: 512, y: 384 };

    const before = worldUnderPointer(viewport, pointer);
    const after = worldUnderPointer(
      zoomToPoint({ viewport, pointer, factor: 1 / ZOOM_SCALE_BY }),
      pointer,
    );

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('не превышает max и держит точку привязки на верхнем лимите', () => {
    const viewport: Viewport = { scale: ZOOM_MAX, x: 50, y: 50 };
    const pointer: Point = { x: 400, y: 300 };

    const before = worldUnderPointer(viewport, pointer);
    // factor > 1, но scale уже на максимуме — должен остаться max
    const result = zoomToPoint({ viewport, pointer, factor: 10 });

    expect(result.scale).toBe(ZOOM_MAX);
    const after = worldUnderPointer(result, pointer);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('не опускается ниже min и держит точку привязки на нижнем лимите', () => {
    const viewport: Viewport = { scale: ZOOM_MIN, x: 0, y: 0 };
    const pointer: Point = { x: 120, y: 90 };

    const before = worldUnderPointer(viewport, pointer);
    const result = zoomToPoint({ viewport, pointer, factor: 0.01 });

    expect(result.scale).toBe(ZOOM_MIN);
    const after = worldUnderPointer(result, pointer);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('уважает кастомные границы min/max', () => {
    const viewport: Viewport = { scale: 1, x: 0, y: 0 };
    const pointer: Point = { x: 10, y: 10 };

    const capped = zoomToPoint({
      viewport,
      pointer,
      factor: 100,
      max: 3,
    });
    expect(capped.scale).toBe(3);

    const floored = zoomToPoint({
      viewport,
      pointer,
      factor: 0.001,
      min: 0.5,
    });
    expect(floored.scale).toBe(0.5);
  });
});

describe('wheelToZoomFactor', () => {
  it('мышь вверх (deltaY < 0) приближает', () => {
    expect(wheelToZoomFactor(-100, false)).toBe(ZOOM_SCALE_BY);
  });

  it('мышь вниз (deltaY > 0) отдаляет', () => {
    expect(wheelToZoomFactor(100, false)).toBe(1 / ZOOM_SCALE_BY);
  });

  it('мышь игнорирует величину deltaY (дискретный шаг)', () => {
    expect(wheelToZoomFactor(-1, false)).toBe(wheelToZoomFactor(-9999, false));
  });

  it('pinch вверх (deltaY < 0) даёт множитель > 1', () => {
    expect(wheelToZoomFactor(-20, true)).toBeGreaterThan(1);
  });

  it('pinch вниз (deltaY > 0) даёт множитель < 1', () => {
    expect(wheelToZoomFactor(20, true)).toBeLessThan(1);
  });

  it('pinch симметричен: f(d) и f(-d) взаимно обратны', () => {
    const inFactor = wheelToZoomFactor(-15, true);
    const outFactor = wheelToZoomFactor(15, true);

    expect(inFactor * outFactor).toBeCloseTo(1);
  });

  it('pinch чувствителен к величине deltaY (непрерывный)', () => {
    expect(wheelToZoomFactor(-40, true)).toBeGreaterThan(wheelToZoomFactor(-10, true));
  });
});
