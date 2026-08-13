import { describe, expect, it } from 'vitest';

import { hitTestElement } from './hitTest';
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

const rect: RectElement = { ...base, type: 'rect', x: 10, y: 10, data: { width: 100, height: 50 } };
const ellipse: EllipseElement = {
  ...base,
  type: 'ellipse',
  x: 0,
  y: 0,
  data: { width: 100, height: 100 },
};
const line: LineElement = { ...base, type: 'line', x: 0, y: 0, data: { points: [0, 0, 100, 0] } };
const arrow: ArrowElement = {
  ...base,
  type: 'arrow',
  x: 0,
  y: 0,
  data: { points: [0, 0, 100, 0] },
};
const freedraw: FreedrawElement = {
  ...base,
  type: 'freedraw',
  x: 0,
  y: 0,
  data: { points: [0, 0, 50, 0, 100, 0] },
};
const dot: FreedrawElement = {
  ...base,
  type: 'freedraw',
  x: 0,
  y: 0,
  data: { points: [10, 10, 10, 10] },
};
const text: TextElement = {
  ...base,
  type: 'text',
  x: 0,
  y: 0,
  data: { text: 'hello', fontSize: 20, fontFamily: 'sans' },
};
const multilineText: TextElement = {
  ...base,
  type: 'text',
  x: 0,
  y: 0,
  data: { text: 'hello\nworld again', fontSize: 20, fontFamily: 'sans' },
};

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

describe('hitTestElement — arrow', () => {
  it('попадает по близости к телу стрелки, как line (наконечник в hit-test не участвует)', () => {
    expect(hitTestElement(arrow, { x: 50, y: 0.5 })).toBe(true);
  });

  it('не попадает вдали от стрелки', () => {
    expect(hitTestElement(arrow, { x: 50, y: 20 })).toBe(false);
  });
});

describe('hitTestElement — freedraw', () => {
  it('попадает по близости к любому сегменту ломаной (переиспользует isNearPolyline line)', () => {
    expect(hitTestElement(freedraw, { x: 75, y: 0.5 })).toBe(true);
  });

  it('не попадает вдали от ломаной', () => {
    expect(hitTestElement(freedraw, { x: 75, y: 20 })).toBe(false);
  });

  it('точка-клякса (две совпадающие точки) тоже попадает по близости', () => {
    expect(hitTestElement(dot, { x: 10.5, y: 10.5 })).toBe(true);
    expect(hitTestElement(dot, { x: 30, y: 30 })).toBe(false);
  });
});

describe('hitTestElement — text (приближённый bbox, не polyline)', () => {
  it('попадает внутрь приближённого bbox однострочного текста', () => {
    // 'hello' (5 симв) * fontSize 20 * 0.6 = 60 ширины; 1 строка * 20 * 1.2 = 24 высоты.
    expect(hitTestElement(text, { x: 30, y: 12 })).toBe(true);
  });

  it('не попадает за пределами приближённого bbox', () => {
    expect(hitTestElement(text, { x: 200, y: 12 })).toBe(false);
  });

  it('tolerance расширяет зону попадания за границу bbox', () => {
    expect(hitTestElement(text, { x: 65, y: 12 })).toBe(false);
    expect(hitTestElement(text, { x: 65, y: 12 }, 10)).toBe(true);
  });

  it('многострочный текст: bbox растёт по высоте и по самой длинной строке', () => {
    // Самая длинная строка 'world again' (11 симв) даёт ширину, вторая (короткая) строка её не сужает.
    expect(hitTestElement(multilineText, { x: 100, y: 30 })).toBe(true);
    expect(hitTestElement(multilineText, { x: 100, y: 60 })).toBe(false);
  });
});

describe('hitTestElement — повёрнутые фигуры (SLT-63)', () => {
  it('rect повёрнут на 90° вокруг угла рамки (пивот x/y) — попадание следует за поворотом', () => {
    // (50,30) внутри НЕвращённого rect. Поворот на 90° вокруг пивота (10,10) переносит эту
    // локальную точку в мировую (-10,50) — та же точка ЛОКАЛЬНО, просто в повёрнутой системе.
    const rotatedRect: RectElement = { ...rect, angle: Math.PI / 2 };
    expect(hitTestElement(rotatedRect, { x: -10, y: 50 })).toBe(true);
    // Исходные координаты (50,30) больше НЕ совпадают с фигурой — геометрия уехала поворотом.
    expect(hitTestElement(rotatedRect, { x: 50, y: 30 })).toBe(false);
  });

  it('ellipse повёрнут на 90° вокруг центра (пивот — не угол, а центр)', () => {
    const asymmetricEllipse: EllipseElement = {
      ...base,
      type: 'ellipse',
      x: 0,
      y: 0,
      data: { width: 100, height: 40 },
    };
    // (90,20) внутри НЕвращённого эллипса (центр 50,20, rx=50,ry=20). После поворота на 90° вокруг
    // центра та же локальная точка оказывается в мировых (50,60).
    const rotated: EllipseElement = { ...asymmetricEllipse, angle: Math.PI / 2 };
    expect(hitTestElement(rotated, { x: 50, y: 60 })).toBe(true);
    // Исходная точка (90,20) после поворота уже мимо повёрнутого эллипса.
    expect(hitTestElement(rotated, { x: 90, y: 20 })).toBe(false);
  });

  it('rect повёрнут на некруглый угол (30°) — sin/cos ≠ 0/1, не только осевой случай', () => {
    // 90° не исключает ошибку знака (проверено вручную), но некруглый угол — более общая гарантия:
    // мировую точку считаем той же прямой формулой поворота, что и unrotatePoint, только вперёд
    // (+angle вместо -angle), поэтому тест независим от хардкода конкретных чисел.
    const angle = Math.PI / 6;
    const pivot = { x: rect.x, y: rect.y }; // rect: пивот — угол рамки
    const local = { x: 60, y: 20 }; // внутри невращённого rect (x:10..110, y:10..60)
    const dx = local.x - pivot.x;
    const dy = local.y - pivot.y;
    const world = {
      x: pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };

    const rotatedRect: RectElement = { ...rect, angle };
    expect(hitTestElement(rotatedRect, world)).toBe(true);
  });
});
