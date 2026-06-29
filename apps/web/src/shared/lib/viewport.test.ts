import { describe, expect, it } from 'vitest';

import { screenToCanvas, type Viewport } from './viewport';

describe('screenToCanvas', () => {
  it('identity-вьюпорт не меняет координаты', () => {
    const viewport: Viewport = { scale: 1, x: 0, y: 0 };
    expect(screenToCanvas({ x: 120, y: 80 }, viewport)).toEqual({ x: 120, y: 80 });
  });

  it('учитывает смещение и масштаб (обратная к screen = canvas*scale + offset)', () => {
    const viewport: Viewport = { scale: 2, x: 100, y: 50 };
    // canvas(40, 25) → screen(40*2+100, 25*2+50) = (180, 100)
    expect(screenToCanvas({ x: 180, y: 100 }, viewport)).toEqual({ x: 40, y: 25 });
  });

  it('является точной обратной к прямой трансформации', () => {
    const viewport: Viewport = { scale: 1.5, x: -30, y: 70 };
    const canvas = { x: 12, y: -8 };
    const screen = {
      x: canvas.x * viewport.scale + viewport.x,
      y: canvas.y * viewport.scale + viewport.y,
    };
    const roundTrip = screenToCanvas(screen, viewport);
    expect(roundTrip.x).toBeCloseTo(canvas.x);
    expect(roundTrip.y).toBeCloseTo(canvas.y);
  });
});
