import { describe, expect, it } from 'vitest';

import { EXPORT_PADDING, getDocumentBounds, getElementBounds, rectsIntersect } from './bounds';
import type {
  ArrowElement,
  EllipseElement,
  FreedrawElement,
  LineElement,
  RectElement,
  TextElement,
} from './types';

const base = {
  id: 'x',
  angle: 0,
  opacity: 1,
  stroke: '#000',
  fill: 'transparent',
  strokeWidth: 2,
  seed: 1,
  order: 0,
  version: 0,
} as const;

describe('getElementBounds — осевые (angle = 0)', () => {
  it('rect: bbox = сама рамка', () => {
    const rect: RectElement = {
      ...base,
      type: 'rect',
      x: 10,
      y: 20,
      data: { width: 100, height: 50 },
    };
    expect(getElementBounds(rect)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });

  it('ellipse: bbox = обрамляющая рамка (не сам эллипс)', () => {
    const ellipse: EllipseElement = {
      ...base,
      type: 'ellipse',
      x: 0,
      y: 0,
      data: { width: 100, height: 40 },
    };
    expect(getElementBounds(ellipse)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 40 });
  });

  it('line: bbox = min/max по относительным точкам + смещение x/y', () => {
    const line: LineElement = {
      ...base,
      type: 'line',
      x: 10,
      y: 10,
      data: { points: [0, 0, 50, -20, 100, 5] },
    };
    expect(getElementBounds(line)).toEqual({ minX: 10, minY: -10, maxX: 110, maxY: 15 });
  });

  it('arrow: та же геометрия, что line', () => {
    const arrow: ArrowElement = {
      ...base,
      type: 'arrow',
      x: 0,
      y: 0,
      data: { points: [0, 0, 100, 0] },
    };
    expect(getElementBounds(arrow)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 0 });
  });

  it('freedraw: min/max по всей ломаной', () => {
    const freedraw: FreedrawElement = {
      ...base,
      type: 'freedraw',
      x: 0,
      y: 0,
      data: { points: [0, 0, 30, -10, 10, 40, 5, 5] },
    };
    expect(getElementBounds(freedraw)).toEqual({ minX: 0, minY: -10, maxX: 30, maxY: 40 });
  });

  it('text: bbox из приближённой метрики (та же, что у hitTest)', () => {
    // 'hello' (5 симв) * 20 * 0.6 = 60 ширины; 1 строка * 20 * 1.2 = 24 высоты.
    const text: TextElement = {
      ...base,
      type: 'text',
      x: 5,
      y: 5,
      data: { text: 'hello', fontSize: 20, fontFamily: 'sans' },
    };
    expect(getElementBounds(text)).toEqual({ minX: 5, minY: 5, maxX: 65, maxY: 29 });
  });
});

describe('getElementBounds — повёрнутые элементы (SLT-64, В1=B)', () => {
  it('rect повёрнут на 90° вокруг угла рамки — bbox тот же размер, сдвинут', () => {
    const rect: RectElement = {
      ...base,
      type: 'rect',
      x: 0,
      y: 0,
      data: { width: 100, height: 50 },
    };
    const rotated: RectElement = { ...rect, angle: Math.PI / 2 };
    const bounds = getElementBounds(rotated);
    // Поворот на 90° вокруг (0,0): (0,0)→(0,0), (100,0)→(0,100), (100,50)→(-50,100), (0,50)→(-50,0).
    expect(bounds.minX).toBeCloseTo(-50);
    expect(bounds.maxX).toBeCloseTo(0);
    expect(bounds.minY).toBeCloseTo(0);
    expect(bounds.maxY).toBeCloseTo(100);
  });

  it('rect повёрнут на несимметричный угол (30°) — bbox БОЛЬШЕ осевого (ловит знак rotatePoint)', () => {
    const rect: RectElement = {
      ...base,
      type: 'rect',
      x: 0,
      y: 0,
      data: { width: 100, height: 50 },
    };
    const axisAligned = getElementBounds(rect);
    const rotated: RectElement = { ...rect, angle: Math.PI / 6 };
    const bounds = getElementBounds(rotated);

    const axisWidth = axisAligned.maxX - axisAligned.minX;
    const axisHeight = axisAligned.maxY - axisAligned.minY;
    const rotatedWidth = bounds.maxX - bounds.minX;
    const rotatedHeight = bounds.maxY - bounds.minY;
    // Повёрнутый axis-aligned bbox прямоугольника всегда >= осевого (кроме кратных 90°).
    expect(rotatedWidth).toBeGreaterThan(axisWidth);
    expect(rotatedHeight).toBeGreaterThan(axisHeight);

    // Явная проверка знака: верхний правый угол (100,0) при повороте на +30° вокруг (0,0) уходит
    // ВПРАВО-ВНИЗ по y (sin(30°)=0.5 > 0), а не влево-вверх — так и определяем maxY.
    const cos30 = Math.cos(Math.PI / 6);
    const sin30 = Math.sin(Math.PI / 6);
    expect(bounds.maxY).toBeCloseTo(100 * sin30 + 50 * cos30);
  });

  it('ellipse повёрнут вокруг ЦЕНТРА (не угла) — несимметричная рамка даёт другой bbox', () => {
    const ellipse: EllipseElement = {
      ...base,
      type: 'ellipse',
      x: 0,
      y: 0,
      data: { width: 100, height: 40 },
    };
    const rotated: EllipseElement = { ...ellipse, angle: Math.PI / 2 };
    const bounds = getElementBounds(rotated);
    // Центр (50,20) неподвижен, рамка 100x40 после поворота на 90° становится 40x100 вокруг центра.
    expect(bounds.minX).toBeCloseTo(50 - 20);
    expect(bounds.maxX).toBeCloseTo(50 + 20);
    expect(bounds.minY).toBeCloseTo(20 - 50);
    expect(bounds.maxY).toBeCloseTo(20 + 50);
  });

  it('angle = 0 — быстрый путь возвращает осевой bbox напрямую', () => {
    const rect: RectElement = {
      ...base,
      type: 'rect',
      x: 1,
      y: 2,
      data: { width: 10, height: 10 },
    };
    expect(getElementBounds(rect)).toEqual({ minX: 1, minY: 2, maxX: 11, maxY: 12 });
  });
});

describe('rectsIntersect', () => {
  it('пересекаются', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b = { minX: 5, minY: 5, maxX: 15, maxY: 15 };
    expect(rectsIntersect(a, b)).toBe(true);
  });

  it('не пересекаются (далеко по X)', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b = { minX: 20, minY: 0, maxX: 30, maxY: 10 };
    expect(rectsIntersect(a, b)).toBe(false);
  });

  it('не пересекаются (далеко по Y)', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b = { minX: 0, minY: 20, maxX: 10, maxY: 30 };
    expect(rectsIntersect(a, b)).toBe(false);
  });

  it('касание по границе считается пересечением', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b = { minX: 10, minY: 0, maxX: 20, maxY: 10 };
    expect(rectsIntersect(a, b)).toBe(true);
  });

  it('вложенность (b целиком внутри a) — пересечение', () => {
    const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const b = { minX: 40, minY: 40, maxX: 60, maxY: 60 };
    expect(rectsIntersect(a, b)).toBe(true);
    expect(rectsIntersect(b, a)).toBe(true);
  });
});

describe('getDocumentBounds (SLT-66)', () => {
  it('пустой документ → null (нечего экспортировать)', () => {
    expect(getDocumentBounds([])).toBeNull();
  });

  it('один элемент — bbox = его собственный + EXPORT_PADDING со всех сторон', () => {
    const rect: RectElement = {
      ...base,
      type: 'rect',
      x: 10,
      y: 20,
      data: { width: 100, height: 50 },
    };
    expect(getDocumentBounds([rect])).toEqual({
      minX: 10 - EXPORT_PADDING,
      minY: 20 - EXPORT_PADDING,
      maxX: 110 + EXPORT_PADDING,
      maxY: 70 + EXPORT_PADDING,
    });
  });

  it('несколько элементов — объединение (min по minX/minY, max по maxX/maxY), не последний элемент', () => {
    const near: RectElement = {
      ...base,
      type: 'rect',
      x: 0,
      y: 0,
      data: { width: 10, height: 10 },
    };
    // Далеко за пределами вьюпорта — объединение обязано его учесть (SLT-66: экспорт всей доски).
    const far: RectElement = {
      ...base,
      type: 'rect',
      x: 5000,
      y: -3000,
      data: { width: 20, height: 20 },
    };
    const bounds = getDocumentBounds([near, far]);
    expect(bounds).toEqual({
      minX: 0 - EXPORT_PADDING,
      minY: -3000 - EXPORT_PADDING,
      maxX: 5020 + EXPORT_PADDING,
      maxY: 10 + EXPORT_PADDING,
    });
  });
});
