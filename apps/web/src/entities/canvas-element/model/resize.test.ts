import { describe, expect, it } from 'vitest';

import { applyResizeTransform } from './resize';
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

describe('applyResizeTransform', () => {
  it('rect: масштабирует width/height по своим осям, x/y берёт из узла', () => {
    const rect: RectElement = {
      ...base,
      type: 'rect',
      x: 10,
      y: 20,
      data: { width: 100, height: 50 },
    };

    const patch = applyResizeTransform(rect, { x: 15, y: 25, scaleX: 2, scaleY: 1.5 });

    expect(patch).toEqual({ x: 15, y: 25, data: { width: 200, height: 75 } });
  });

  it('rect: strokeWidth и angle не попадают в патч', () => {
    const rect: RectElement = {
      ...base,
      type: 'rect',
      x: 0,
      y: 0,
      data: { width: 10, height: 10 },
    };

    const patch = applyResizeTransform(rect, { x: 0, y: 0, scaleX: 3, scaleY: 3 });

    expect(patch).not.toHaveProperty('strokeWidth');
    expect(patch).not.toHaveProperty('angle');
  });

  it('ellipse: узел стоит в центре — новые x/y считаются от ОТМАСШТАБИРОВАННЫХ width/height', () => {
    const ellipse: EllipseElement = {
      ...base,
      type: 'ellipse',
      x: 0,
      y: 0,
      data: { width: 100, height: 100 },
    };
    // Узел (центр) остался в той же точке (50,50), но габарит вырос вдвое — угол рамки уезжает.
    const patch = applyResizeTransform(ellipse, { x: 50, y: 50, scaleX: 2, scaleY: 2 });

    expect(patch).toEqual({ x: -50, y: -50, data: { width: 200, height: 200 } });
  });

  it('line: точки масштабируются относительно origin по своим осям (чёт — x, нечёт — y)', () => {
    const line: LineElement = {
      ...base,
      type: 'line',
      x: 5,
      y: 5,
      data: { points: [0, 0, 100, 50] },
    };

    const patch = applyResizeTransform(line, { x: 5, y: 5, scaleX: 2, scaleY: 0.5 });

    expect(patch).toEqual({ x: 5, y: 5, data: { points: [0, 0, 200, 25] } });
  });

  it('arrow: та же формула, что у line', () => {
    const arrow: ArrowElement = {
      ...base,
      type: 'arrow',
      x: 0,
      y: 0,
      data: { points: [0, 0, 40, 20] },
    };

    const patch = applyResizeTransform(arrow, { x: 0, y: 0, scaleX: 3, scaleY: 2 });

    expect(patch).toEqual({ x: 0, y: 0, data: { points: [0, 0, 120, 40] } });
  });

  it('freedraw: масштабирует весь поток точек, не только концы', () => {
    const freedraw: FreedrawElement = {
      ...base,
      type: 'freedraw',
      x: 0,
      y: 0,
      data: { points: [0, 0, 10, 10, 20, 0] },
    };

    const patch = applyResizeTransform(freedraw, { x: 0, y: 0, scaleX: 2, scaleY: 2 });

    expect(patch).toEqual({ x: 0, y: 0, data: { points: [0, 0, 20, 20, 40, 0] } });
  });

  it('text: fontSize растёт пропорционально scaleX (keepRatio), width/height не появляются', () => {
    const text: TextElement = {
      ...base,
      type: 'text',
      x: 0,
      y: 0,
      data: { text: 'hi', fontSize: 20, fontFamily: 'sans' },
    };

    const patch = applyResizeTransform(text, { x: 0, y: 0, scaleX: 2, scaleY: 2 });

    expect(patch).toEqual({ x: 0, y: 0, data: { text: 'hi', fontSize: 40, fontFamily: 'sans' } });
  });

  it('text: fontSize зажимается снизу TEXT_FONT_SIZE_MIN', () => {
    const text: TextElement = {
      ...base,
      type: 'text',
      x: 0,
      y: 0,
      data: { text: 'hi', fontSize: 20, fontFamily: 'sans' },
    };

    const patch = applyResizeTransform(text, { x: 0, y: 0, scaleX: 0.1, scaleY: 0.1 });

    expect(patch.data).toMatchObject({ fontSize: 8 });
  });

  it('text: fontSize зажимается сверху TEXT_FONT_SIZE_MAX', () => {
    const text: TextElement = {
      ...base,
      type: 'text',
      x: 0,
      y: 0,
      data: { text: 'hi', fontSize: 20, fontFamily: 'sans' },
    };

    const patch = applyResizeTransform(text, { x: 0, y: 0, scaleX: 50, scaleY: 50 });

    expect(patch.data).toMatchObject({ fontSize: 200 });
  });
});
