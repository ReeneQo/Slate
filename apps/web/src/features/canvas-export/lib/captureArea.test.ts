import { describe, expect, it } from 'vitest';

import {
  type Bounds,
  EXPORT_PADDING,
  getDocumentBounds,
  type RectElement,
} from '@/entities/canvas-element';
import type { Viewport } from '@/shared/lib/viewport';

import { computeCaptureArea } from './captureArea';

describe('computeCaptureArea (SLT-66)', () => {
  it('viewport в исходном положении (scale=1, x=0, y=0) — область = сам bbox', () => {
    const bounds: Bounds = { minX: 10, minY: 20, maxX: 110, maxY: 70 };
    const viewport: Viewport = { scale: 1, x: 0, y: 0 };
    expect(computeCaptureArea(bounds, viewport)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('bbox вне текущего вьюпорта — область всё равно считается по формуле world*scale+pan', () => {
    // Доска отпанена так, что bbox доски давно вне видимого окна — это и есть смысл SLT-66.
    const bounds: Bounds = { minX: 5000, minY: -3000, maxX: 5100, maxY: -2950 };
    const viewport: Viewport = { scale: 0.5, x: -1000, y: 500 };
    expect(computeCaptureArea(bounds, viewport)).toEqual({
      x: 5000 * 0.5 + -1000,
      y: -3000 * 0.5 + 500,
      width: 100 * 0.5,
      height: 50 * 0.5,
    });
  });

  it('масштаб и смещение применяются корректно к позиции и к размеру', () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const viewport: Viewport = { scale: 2, x: 40, y: -10 };
    expect(computeCaptureArea(bounds, viewport)).toEqual({
      x: 40,
      y: -10,
      width: 400,
      height: 200,
    });
  });
});

describe('getDocumentBounds → computeCaptureArea (SLT-66, регрессия на стык padding)', () => {
  // Легко ошибиться отдельно: прибавить EXPORT_PADDING к min, забыть прибавить его к
  // ширине/высоте области снятия. computeCaptureArea НЕ считает padding сам — он берёт готовый
  // Bounds от getDocumentBounds, где minX/maxX УЖЕ раздвинуты на padding в разные стороны, поэтому
  // (maxX - minX) автоматически включает 2×EXPORT_PADDING. Тест фиксирует именно эту композицию.
  it('область снятия шире исходной геометрии ровно на 2×EXPORT_PADDING по каждой оси', () => {
    const rect: RectElement = {
      id: 'x',
      type: 'rect',
      angle: 0,
      opacity: 1,
      stroke: '#000',
      fill: 'transparent',
      strokeWidth: 2,
      seed: 1,
      order: 0,
      version: 0,
      x: 10,
      y: 20,
      data: { width: 100, height: 50 },
    };
    const bounds = getDocumentBounds([rect]);
    expect(bounds).not.toBeNull();

    const viewport: Viewport = { scale: 1, x: 0, y: 0 };
    const area = computeCaptureArea(bounds as Bounds, viewport);

    expect(area).toEqual({
      x: 10 - EXPORT_PADDING,
      y: 20 - EXPORT_PADDING,
      width: 100 + 2 * EXPORT_PADDING,
      height: 50 + 2 * EXPORT_PADDING,
    });
  });
});
