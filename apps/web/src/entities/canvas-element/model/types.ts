/**
 * Контракт элемента холста. ВАЖНО: это будущий контракт с бэком (этап 2 —
 * переедет в packages/shared-types и будет сохраняться в БД) и единица истории
 * (будущие undo/redo). Поэтому:
 *  - только JSON-сериализуемые поля (примитивы, массивы чисел);
 *  - НИКАКИХ Konva-инстансов, функций, классов, ссылок на DOM.
 */

/** Виды фигур этапа 1. Союз расширяется под будущие 'text' | 'arrow' | 'freedraw'. */
export type ElementType = 'rect' | 'ellipse' | 'line';

/** Инструмент тулбара: курсор-выделение + по инструменту на каждый вид фигуры. */
export type ToolType = 'select' | ElementType;

/**
 * Общие поля всех элементов.
 *
 * angle и seed заложены сейчас «на вырост», чтобы не мигрировать контракт позже:
 *  - angle — поворот в градусах (как rotation у Konva). Этап 1 не вращает, всегда 0.
 *  - seed — зерно для будущего «рукотворного» рендера (rough.js). Этап 1 не использует.
 *
 * Координаты x/y — в координатах холста (не экранных), x/y = левый верхний угол.
 */
export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  angle: number;
  opacity: number;
  stroke: string;
  fill: string;
  strokeWidth: number;
  seed: number;
}

/** Прямоугольник/эллипс делят одну геометрию — прямоугольную рамку. */
export interface RectElement extends BaseElement {
  type: 'rect';
  width: number;
  height: number;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
  width: number;
  height: number;
}

/**
 * Линия как массив точек [x1,y1,x2,y2,...], координаты ОТНОСИТЕЛЬНО x/y элемента
 * (первая точка — [0,0]). Этап 1 — две точки, но модель сразу готова к freedraw
 * (та же points с N точками) и не потребует миграции.
 */
export interface LineElement extends BaseElement {
  type: 'line';
  points: number[];
}

/** Дискриминированный союз по `type`. Единственная «точка правды» о фигуре. */
export type CanvasElement = RectElement | EllipseElement | LineElement;

/**
 * Дистрибутивный Omit: обычный Omit<Union, K> схлопывает дискриминированный союз
 * и теряет сужение по `type`. Эта версия применяет Omit к каждому члену союза.
 */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * Черновик — фигура, которую сейчас тащим мышью. id ещё нет: он рождается только
 * в момент коммита (mouseup) в экшене стора. Превью рисуется из черновика.
 */
export type DraftElement = DistributiveOmit<CanvasElement, 'id'>;

/**
 * Документ доски. Версия — на уровне документа, не элемента. elements — словарь
 * (точечные апдейты в реалтайме дешевле массива), elementIds — порядок отрисовки
 * (z-index). Инвариант: elements и elementIds всегда синхронны.
 */
export interface CanvasDocument {
  schemaVersion: number;
  elements: Record<string, CanvasElement>;
  elementIds: string[];
}
