import type { Point } from '@/shared/lib/viewport';

import type { DraftElement, ElementType } from './types';

/** Версия схемы документа. Растёт при несовместимых изменениях контракта. */
export const SCHEMA_VERSION = 1;

/**
 * Стиль по умолчанию для новой фигуры. fill прозрачный — как в Excalidraw фигуры
 * по умолчанию контурные. Вынесено в константу, чтобы тулбар/настройки стиля
 * позже переопределяли в одном месте.
 */
export const DEFAULT_STYLE = {
  stroke: '#272d36',
  fill: 'transparent',
  strokeWidth: 2,
  opacity: 1,
} as const;

/**
 * Минимальный размер фигуры (в координатах холста), ниже которого жест считаем
 * случайным кликом и НЕ коммитим — иначе словарь засоряется нулевыми элементами.
 */
const MIN_COMMIT_SIZE = 3;

/** Зерно для будущего rough.js-рендера. Целое, сериализуемое. */
function makeSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Черновик новой фигуры в точке старта. Без id (родится при коммите). Геометрия
 * нулевая (в `data`) — наполняется в updateDraftGeometry по мере перетаскивания мыши.
 */
export function createDraft(type: ElementType, start: Point): DraftElement {
  const common = {
    x: start.x,
    y: start.y,
    angle: 0,
    seed: makeSeed(),
    ...DEFAULT_STYLE,
  };

  if (type === 'line') {
    return { type: 'line', ...common, data: { points: [0, 0, 0, 0] } };
  }
  return { type, ...common, data: { width: 0, height: 0 } };
}

/**
 * Обновляет геометрию черновика под текущую позицию курсора (клик-драг).
 * Для rect/ellipse width/height могут быть отрицательными во время драга —
 * нормализуем при коммите. Для линии точки храним относительно x/y старта.
 */
export function updateDraftGeometry(draft: DraftElement, current: Point): DraftElement {
  if (draft.type === 'line') {
    return { ...draft, data: { points: [0, 0, current.x - draft.x, current.y - draft.y] } };
  }
  return { ...draft, data: { width: current.x - draft.x, height: current.y - draft.y } };
}

/**
 * Нормализует размеры: отрицательные width/height во время драга превращаем
 * в положительные, x/y сдвигаем в левый верхний угол. Чистая функция —
 * вызывается при коммите. Линию не трогаем (точки относительные).
 */
export function normalizeBounds(draft: DraftElement): DraftElement {
  if (draft.type === 'line') return draft;

  const { x, y } = draft;
  const { width, height } = draft.data;
  return {
    ...draft,
    x: width < 0 ? x + width : x,
    y: height < 0 ? y + height : y,
    data: { width: Math.abs(width), height: Math.abs(height) },
  };
}

/**
 * Стоит ли коммитить черновик. Отсекает случайные клики без драга (нулевой размер).
 * Для линии меряем длину «коробки» по точкам, для остального — width/height.
 */
export function isCommittable(draft: DraftElement): boolean {
  if (draft.type === 'line') {
    // Дефолты в деструктуризации удовлетворяют noUncheckedIndexedAccess
    // и безопасны: линия всегда имеет минимум две точки.
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = draft.data.points;
    return Math.abs(x2 - x1) >= MIN_COMMIT_SIZE || Math.abs(y2 - y1) >= MIN_COMMIT_SIZE;
  }
  return (
    Math.abs(draft.data.width) >= MIN_COMMIT_SIZE && Math.abs(draft.data.height) >= MIN_COMMIT_SIZE
  );
}
