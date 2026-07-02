import { describe, expect, it } from 'vitest';

import { hitTestElement } from './hitTest';
import type { EllipseElement, LineElement, RectElement } from './types';

const base = {
  id: 'x',
  angle: 0,
  opacity: 1,
  stroke: '#000',
  fill: 'transparent',
  strokeWidth: 2,
  seed: 1,
} as const;

const rect: RectElement = { ...base, type: 'rect', x: 10, y: 10, width: 100, height: 50 };
const ellipse: EllipseElement = { ...base, type: 'ellipse', x: 0, y: 0, width: 100, height: 100 };
const line: LineElement = { ...base, type: 'line', x: 0, y: 0, points: [0, 0, 100, 0] };

describe('hitTestElement — rect', () => {
  it('попадает внутрь рамки даже при прозрачной заливке', () => {
    expect(hitTestElement(rect, { x: 50, y: 30 })).toBe(true);
  });

  it('не попадает снаружи', () => {
    expect(hitTestElement(rect, { x: 200, y: 30 })).toBe(false);
  });

  it('tolerance расширяет зону попадания за границу', () => {
    expect(hitTestElement(rect, { x: 113, y: 30 })).toBe(false);
    expect(hitTestElement(rect, { x: 113, y: 30 }, 5)).toBe(true);
  });
});

describe('hitTestElement — ellipse', () => {
  it('центр внутри', () => {
    expect(hitTestElement(ellipse, { x: 50, y: 50 })).toBe(true);
  });

  it('угол bounding box вне эллипса', () => {
    expect(hitTestElement(ellipse, { x: 2, y: 2 })).toBe(false);
  });
});

describe('hitTestElement — line', () => {
  it('попадает по близости к отрезку с учётом толщины', () => {
    expect(hitTestElement(line, { x: 50, y: 0.5 })).toBe(true);
  });

  it('не попадает вдали от отрезка', () => {
    expect(hitTestElement(line, { x: 50, y: 20 })).toBe(false);
  });

  it('tolerance добавляется к порогу расстояния', () => {
    expect(hitTestElement(line, { x: 50, y: 5 })).toBe(false);
    expect(hitTestElement(line, { x: 50, y: 5 }, 5)).toBe(true);
  });
});
