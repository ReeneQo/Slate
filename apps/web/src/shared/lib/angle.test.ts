import { describe, expect, it } from 'vitest';

import { degToRad, normalizeAngle, radToDeg } from './angle';

describe('radToDeg / degToRad', () => {
  it('radToDeg переводит известные углы', () => {
    expect(radToDeg(0)).toBe(0);
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
  });

  it('degToRad переводит известные углы', () => {
    expect(degToRad(0)).toBe(0);
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
  });

  it('round-trip radToDeg(degToRad(x)) === x', () => {
    for (const deg of [0, 45, 90, 137.5, 270, 359]) {
      expect(radToDeg(degToRad(deg))).toBeCloseTo(deg);
    }
  });

  it('round-trip degToRad(radToDeg(x)) === x', () => {
    for (const rad of [0, Math.PI / 4, Math.PI, 3.7, -1.2]) {
      expect(degToRad(radToDeg(rad))).toBeCloseTo(rad);
    }
  });
});

describe('normalizeAngle', () => {
  it('0 остаётся 0', () => {
    expect(normalizeAngle(0)).toBe(0);
  });

  it('370° (в радианах) сводится к 10°', () => {
    expect(radToDeg(normalizeAngle(degToRad(370)))).toBeCloseTo(10);
  });

  it('-10° (в радианах) сводится к 350°', () => {
    expect(radToDeg(normalizeAngle(degToRad(-10)))).toBeCloseTo(350);
  });

  it('360°/2π сводится к 0', () => {
    expect(normalizeAngle(2 * Math.PI)).toBeCloseTo(0);
    expect(radToDeg(normalizeAngle(degToRad(360)))).toBeCloseTo(0);
  });

  it('результат всегда в [0, 2π)', () => {
    for (const deg of [-720, -395, -1, 0, 359, 720, 1080.5]) {
      const result = normalizeAngle(degToRad(deg));
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(2 * Math.PI);
    }
  });
});
