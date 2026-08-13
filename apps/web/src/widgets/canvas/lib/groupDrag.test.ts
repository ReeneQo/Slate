import { describe, expect, it } from 'vitest';

import { computeGroupDragPositions } from './groupDrag';

describe('computeGroupDragPositions', () => {
  it('сдвигает каждого сиблинга на одну и ту же дельту от его старт-позиции', () => {
    const siblings = [
      { id: 'a', startX: 0, startY: 0 },
      { id: 'b', startX: 10, startY: 20 },
    ];
    expect(computeGroupDragPositions(siblings, 5, -3)).toEqual([
      { id: 'a', x: 5, y: -3 },
      { id: 'b', x: 15, y: 17 },
    ]);
  });

  it('нулевая дельта — позиции не меняются', () => {
    const siblings = [{ id: 'a', startX: 42, startY: 7 }];
    expect(computeGroupDragPositions(siblings, 0, 0)).toEqual([{ id: 'a', x: 42, y: 7 }]);
  });

  it('пустой список сиблингов — пустой результат', () => {
    expect(computeGroupDragPositions([], 10, 10)).toEqual([]);
  });
});
