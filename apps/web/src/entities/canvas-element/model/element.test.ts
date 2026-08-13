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
      data: { width: 0, height: 0 },
      angle: 0,
      ...DEFAULT_STYLE,
    });
    expect(typeof draft.seed).toBe('number');
  });

  it('линия стартует двумя совпадающими точками', () => {
    const draft = createDraft('line', { x: 5, y: 5 });
    expect(draft.type).toBe('line');
    if (draft.type === 'line') {
      expect(draft.data.points).toEqual([0, 0, 0, 0]);
    }
  });

  it('черновик полностью JSON-сериализуем (контракт с бэком)', () => {
    const draft = createDraft('ellipse', { x: 1, y: 2 });
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });

  it('freedraw стартует ОДНОЙ точкой (в отличие от line — двух совпадающих)', () => {
    const draft = createDraft('freedraw', { x: 5, y: 5 });
    expect(draft.type).toBe('freedraw');
    if (draft.type === 'freedraw') {
      expect(draft.data.points).toEqual([0, 0]);
    }
  });

  it('arrow стартует двумя совпадающими точками, как line', () => {
    const draft = createDraft('arrow', { x: 5, y: 5 });
    expect(draft.type).toBe('arrow');
    if (draft.type === 'arrow') {
      expect(draft.data.points).toEqual([0, 0, 0, 0]);
    }
  });

  it('text стартует пустым содержимым и дефолтным шрифтом в точке клика (НЕ геометрия точек)', () => {
    const draft = createDraft('text', { x: 5, y: 5 });
    expect(draft.type).toBe('text');
    if (draft.type === 'text') {
      expect(draft.data).toEqual({ text: '', fontSize: 20, fontFamily: 'sans' });
    }
  });
});

describe('updateDraftGeometry', () => {
  it('rect/ellipse: width/height = current - start (можно отрицательные)', () => {
    const draft = createDraft('rect', { x: 100, y: 100 });
    const dragged = updateDraftGeometry(draft, { x: 60, y: 140 });
    if (dragged.type !== 'rect') throw new Error('ожидался rect');
    expect(dragged.data.width).toBe(-40);
    expect(dragged.data.height).toBe(40);
  });

  it('line: точки относительно старта', () => {
    const draft = createDraft('line', { x: 100, y: 100 });
    const dragged = updateDraftGeometry(draft, { x: 130, y: 90 });
    if (dragged.type !== 'line') throw new Error('ожидалась line');
    expect(dragged.data.points).toEqual([0, 0, 30, -10]);
  });

  it('freedraw: точка ДОБАВЛЯЕТСЯ в конец потока, а не перезаписывает вторую', () => {
    const draft = createDraft('freedraw', { x: 100, y: 100 });
    const afterFirst = updateDraftGeometry(draft, { x: 110, y: 100 });
    const afterSecond = updateDraftGeometry(afterFirst, { x: 110, y: 120 });
    if (afterSecond.type !== 'freedraw') throw new Error('ожидался freedraw');
    expect(afterSecond.data.points).toEqual([0, 0, 10, 0, 10, 20]);
  });

  it('arrow: точки относительно старта, как у line (перезапись, не append)', () => {
    const draft = createDraft('arrow', { x: 100, y: 100 });
    const dragged = updateDraftGeometry(draft, { x: 130, y: 90 });
    if (dragged.type !== 'arrow') throw new Error('ожидалась arrow');
    expect(dragged.data.points).toEqual([0, 0, 30, -10]);
  });

  it('text: no-op — драг мышью не меняет содержимое (геометрию меняет только оверлей ввода)', () => {
    const draft = createDraft('text', { x: 100, y: 100 });
    const dragged = updateDraftGeometry(draft, { x: 130, y: 90 });
    expect(dragged).toEqual(draft);
  });
});

describe('normalizeBounds', () => {
  it('отрицательные размеры → положительные, x/y в левый верхний угол', () => {
    const draft = updateDraftGeometry(createDraft('rect', { x: 100, y: 100 }), {
      x: 60,
      y: 140,
    });
    const normalized = normalizeBounds(draft);
    if (normalized.type !== 'rect') throw new Error('ожидался rect');
    expect(normalized).toMatchObject({ x: 60, y: 100, data: { width: 40, height: 40 } });
  });

  it('freedraw не трогает (точки относительные, как у line)', () => {
    const draft = updateDraftGeometry(createDraft('freedraw', { x: 0, y: 0 }), {
      x: -10,
      y: -20,
    });
    expect(normalizeBounds(draft)).toEqual(draft);
  });

  it('линию не трогает (точки относительные)', () => {
    const draft = updateDraftGeometry(createDraft('line', { x: 0, y: 0 }), {
      x: -10,
      y: -20,
    });
    expect(normalizeBounds(draft)).toEqual(draft);
  });

  it('arrow не трогает, как line (точки относительные)', () => {
    const draft = updateDraftGeometry(createDraft('arrow', { x: 0, y: 0 }), {
      x: -10,
      y: -20,
    });
    expect(normalizeBounds(draft)).toEqual(draft);
  });

  it('text не трогает (нет драг-рамки — нормализовать нечего)', () => {
    const draft = createDraft('text', { x: 10, y: 20 });
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

  it('freedraw: пропускает даже одиночную точку без движения (клик = точка-клякса)', () => {
    // В отличие от rect/line, freedraw НЕ отсекает клик без драга — мазок из одной точки
    // коммитится (см. useDrawing: на mouseup она дублируется в точку-кляксу).
    expect(isCommittable(createDraft('freedraw', { x: 0, y: 0 }))).toBe(true);
  });

  it('отсекает arrow-клик без драга (нулевой размер), как line', () => {
    expect(isCommittable(createDraft('arrow', { x: 0, y: 0 }))).toBe(false);
  });

  it('пропускает arrow ненулевой длины', () => {
    const draft = updateDraftGeometry(createDraft('arrow', { x: 0, y: 0 }), {
      x: 40,
      y: 0,
    });
    expect(isCommittable(draft)).toBe(true);
  });

  it('отсекает пустой text (свежесозданный черновик без ввода)', () => {
    expect(isCommittable(createDraft('text', { x: 0, y: 0 }))).toBe(false);
  });

  it('отсекает text из одних пробелов/переносов (trim пуст)', () => {
    const draft = createDraft('text', { x: 0, y: 0 });
    if (draft.type !== 'text') throw new Error('ожидался text');
    expect(isCommittable({ ...draft, data: { ...draft.data, text: '   \n  ' } })).toBe(false);
  });

  it('пропускает text с непустым содержимым', () => {
    const draft = createDraft('text', { x: 0, y: 0 });
    if (draft.type !== 'text') throw new Error('ожидался text');
    expect(isCommittable({ ...draft, data: { ...draft.data, text: 'привет' } })).toBe(true);
  });
});
