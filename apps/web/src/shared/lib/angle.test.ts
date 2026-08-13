import { describe, expect, it } from 'vitest';

import { degToRad, normalizeAngle, radToDeg, rotatePoint } from './angle';

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

describe('rotatePoint', () => {
  it('поворот на 0 — точка не двигается', () => {
    expect(rotatePoint({ x: 5, y: 3 }, { x: 1, y: 1 }, 0)).toEqual({ x: 5, y: 3 });
  });

  it('90° вокруг начала координат: (1,0) → (0,1)', () => {
    const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(1);
  });

  it('180° вокруг непустого пивота — точка симметрична относительно пивота', () => {
    const result = rotatePoint({ x: 10, y: 10 }, { x: 5, y: 5 }, Math.PI);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it('round-trip: поворот на angle и обратно на -angle возвращает исходную точку', () => {
    const pivot = { x: 3, y: -2 };
    const point = { x: 12, y: 7 };
    const angle = Math.PI / 6; // 30°, несимметричный угол — ловит ошибку знака
    const rotated = rotatePoint(point, pivot, angle);
    const back = rotatePoint(rotated, pivot, -angle);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('несимметричный угол (30°) даёт конкретную мировую точку — знак формулы', () => {
    // Та же формула, что используется в hitTest.test.ts (SLT-63) для проверки unrotatePoint —
    // rotatePoint должен воспроизводить её один в один с +angle.
    const pivot = { x: 10, y: 10 };
    const local = { x: 60, y: 20 };
    const angle = Math.PI / 6;
    const dx = local.x - pivot.x;
    const dy = local.y - pivot.y;
    const expected = {
      x: pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
    const result = rotatePoint(local, pivot, angle);
    expect(result.x).toBeCloseTo(expected.x);
    expect(result.y).toBeCloseTo(expected.y);
  });
});
