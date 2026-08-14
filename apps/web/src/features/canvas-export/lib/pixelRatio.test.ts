import { describe, expect, it } from 'vitest';

import {
  computeEffectivePixelRatio,
  EXPORT_PIXEL_RATIO,
  MAX_EXPORT_PIXEL_RATIO,
  MIN_EXPORT_PIXEL_RATIO,
} from './pixelRatio';

describe('computeEffectivePixelRatio (SLT-66)', () => {
  it('scale = 1 (100%) — базовый случай, ratio = EXPORT_PIXEL_RATIO без клампа', () => {
    expect(computeEffectivePixelRatio(1)).toBe(EXPORT_PIXEL_RATIO);
  });

  it('сильный отзум (scale маленький) — клампится сверху, не улетает в бесконечность', () => {
    expect(computeEffectivePixelRatio(0.01)).toBe(MAX_EXPORT_PIXEL_RATIO);
  });

  it('сильное приближение (scale большой) — клампится снизу, не уходит ниже 1', () => {
    expect(computeEffectivePixelRatio(10)).toBe(MIN_EXPORT_PIXEL_RATIO);
  });

  it('scale = 0.05 — raw = 2/0.05 = 40, клампится до MAX_EXPORT_PIXEL_RATIO (4)', () => {
    expect(computeEffectivePixelRatio(0.05)).toBe(4);
    expect(computeEffectivePixelRatio(0.05)).toBe(MAX_EXPORT_PIXEL_RATIO);
  });

  it('scale = 4 — raw = 2/4 = 0.5, клампится до MIN_EXPORT_PIXEL_RATIO (1)', () => {
    expect(computeEffectivePixelRatio(4)).toBe(1);
    expect(computeEffectivePixelRatio(4)).toBe(MIN_EXPORT_PIXEL_RATIO);
  });

  it('scale = 0.8 (внутри диапазона) — компенсация без клампа', () => {
    expect(computeEffectivePixelRatio(0.8)).toBe(2.5);
  });

  it('scale = 2 (внутри диапазона) — компенсация без клампа', () => {
    expect(computeEffectivePixelRatio(2)).toBe(1);
  });
});
