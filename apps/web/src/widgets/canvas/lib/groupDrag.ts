/**
 * Чистая математика drag ГРУППЫ (SLT-64, Вариант B) — без Konva, легко тестируется. Ведущий узел
 * тащится нативным Konva draggable (как и одиночный drag), остальные выделенные узлы сдвигаются
 * на ту же дельту. Дельта — трансляция, инвариантна относительно происхождения узла (центр у
 * ellipse, угол у остальных типов), поэтому одна и та же (dx, dy), посчитанная в координатах
 * ведущего узла, применяется к МОДЕЛЬНЫМ x/y любого другого типа без пересчёта происхождения.
 */
export interface GroupDragSibling {
  id: string;
  startX: number;
  startY: number;
}

export interface GroupDragPosition {
  id: string;
  x: number;
  y: number;
}

export function computeGroupDragPositions(
  siblings: GroupDragSibling[],
  dx: number,
  dy: number,
): GroupDragPosition[] {
  return siblings.map((sibling) => ({
    id: sibling.id,
    x: sibling.startX + dx,
    y: sibling.startY + dy,
  }));
}
