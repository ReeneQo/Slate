import { describe, expect, it } from 'vitest';

import {
  createDraft,
  DEFAULT_STYLE,
  isCommittable,
  normalizeBounds,
  updateDraftGeometry,
} from './element';

describe('createDraft', () => {
  it('создаёт черновик без id (id рождается только при коммите)', () => {
    const draft = createDraft('rect', { x: 10, y: 20 });
    expect('id' in draft).toBe(false);
  });

  it('кладёт стиль по умолчанию и нулевую геометрию в точке старта', () => {
    const draft = createDraft('rect', { x: 10, y: 20 });
    expect(draft).toMatchObject({
      type: 'rect',
      x: 10,
      y: 20,
      width: 0,
      height: 0,
      angle: 0,
      ...DEFAULT_STYLE,
    });
    expect(typeof draft.seed).toBe('number');
  });

  it('линия стартует двумя совпадающими точками', () => {
    const draft = createDraft('line', { x: 5, y: 5 });
    expect(draft.type).toBe('line');
    if (draft.type === 'line') {
      expect(draft.points).toEqual([0, 0, 0, 0]);
    }
  });

  it('черновик полностью JSON-сериализуем (контракт с бэком)', () => {
    const draft = createDraft('ellipse', { x: 1, y: 2 });
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });
});

describe('updateDraftGeometry', () => {
  it('rect/ellipse: width/height = current - start (можно отрицательные)', () => {
    const draft = createDraft('rect', { x: 100, y: 100 });
    const dragged = updateDraftGeometry(draft, { x: 60, y: 140 });
    if (dragged.type === 'line') throw new Error('ожидался rect');
    expect(dragged.width).toBe(-40);
    expect(dragged.height).toBe(40);
  });

  it('line: точки относительно старта', () => {
    const draft = createDraft('line', { x: 100, y: 100 });
    const dragged = updateDraftGeometry(draft, { x: 130, y: 90 });
    if (dragged.type !== 'line') throw new Error('ожидалась line');
    expect(dragged.points).toEqual([0, 0, 30, -10]);
  });
});

describe('normalizeBounds', () => {
  it('отрицательные размеры → положительные, x/y в левый верхний угол', () => {
    const draft = updateDraftGeometry(createDraft('rect', { x: 100, y: 100 }), {
      x: 60,
      y: 140,
    });
    const normalized = normalizeBounds(draft);
    if (normalized.type === 'line') throw new Error('ожидался rect');
    expect(normalized).toMatchObject({ x: 60, y: 100, width: 40, height: 40 });
  });

  it('линию не трогает (точки относительные)', () => {
    const draft = updateDraftGeometry(createDraft('line', { x: 0, y: 0 }), {
      x: -10,
      y: -20,
    });
    expect(normalizeBounds(draft)).toEqual(draft);
  });
});

describe('isCommittable', () => {
  it('отсекает клик без драга (нулевой размер)', () => {
    expect(isCommittable(createDraft('rect', { x: 0, y: 0 }))).toBe(false);
  });

  it('пропускает фигуру достаточного размера', () => {
    const draft = updateDraftGeometry(createDraft('rect', { x: 0, y: 0 }), {
      x: 50,
      y: 30,
    });
    expect(isCommittable(draft)).toBe(true);
  });

  it('пропускает линию ненулевой длины', () => {
    const draft = updateDraftGeometry(createDraft('line', { x: 0, y: 0 }), {
      x: 40,
      y: 0,
    });
    expect(isCommittable(draft)).toBe(true);
  });
});
