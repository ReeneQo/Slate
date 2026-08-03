/**
 * Доменная модель элемента холста. Теперь это НЕ самостоятельный контракт, а надстройка над
 * серверным контрактом из @slate/shared-types (SLT-27): общие поля берём ОДНИМ типом из пакета,
 * чтобы клиент и сервер не описывали одну фигуру двумя способами и не разъезжались молча.
 *
 * `CanvasElement` = серверный `ElementResponse` МИНУС поля, которых у клиента в модели нет:
 *  - `boardId` — известен из роута (`/boards/:id`), в create прокидывается снаружи (SLT-27, Р8);
 *  - `createdAt` / `updatedAt` — серверные метаданные, рендеру не нужны.
 * Эти поля не «эфемерны на клиенте» — они просто живут не в модели фигуры (boardId — контекст
 * доски, даты — забота сервера). Отдельного слоя клиентских эфемерных полей у закоммиченной
 * фигуры нет: черновик (`DraftElement`), выделение и вьюпорт живут в editor-сторе, не здесь.
 *
 * Как и раньше — только JSON-сериализуемые поля: никаких Konva-инстансов, функций, ссылок на DOM.
 */

import type { ElementData, ElementResponse, ElementType } from '@slate/shared-types';

export type { ElementType };

/** Инструмент тулбара: курсор-выделение + по инструменту на каждый вид фигуры. */
export type ToolType = 'select' | ElementType;

/**
 * Дистрибутивный Omit: обычный Omit<Union, K> схлопывает дискриминированный союз и теряет
 * сужение по `type`. Эта версия применяет Omit к каждому члену союза по отдельности.
 */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Поля, которые сервер знает, а модель фигуры на клиенте не держит (см. шапку файла). */
type ServerOnlyFields = 'boardId' | 'createdAt' | 'updatedAt';

/**
 * Элемент холста на клиенте — серверная фигура без серверного контекста. Геометрия лежит в
 * `data` (`{ width, height }` для rect/ellipse, `{ points }` для line) — ровно как на бэке,
 * поэтому маппинг «клиент → тело PUT» это по сути добавление boardId, без переукладки полей.
 *
 * ВНИМАНИЕ про `angle`: серверный контракт задаёт его в РАДИАНАХ (element.contracts.ts), а
 * ElementShape сейчас скармливает значение Konva как `rotation` (ГРАДУСЫ). Этап 1 не вращает —
 * angle всегда 0, где радианы и градусы совпадают, поэтому расхождение латентно и не проявляется.
 * Когда появится вращение (Transformer, rotate), единицу надо свести на границе рендера. См.
 * развилку в описании SLT-27.
 */
export type CanvasElement = DistributiveOmit<ElementResponse, ServerOnlyFields>;

/** Сужения союза по типу — публичная поверхность для потребителей (hit-test, тесты). */
export type RectElement = Extract<CanvasElement, { type: 'rect' }>;
export type EllipseElement = Extract<CanvasElement, { type: 'ellipse' }>;
export type LineElement = Extract<CanvasElement, { type: 'line' }>;

/** Общие (не зависящие от вида фигуры) поля. Держим как псевдоним — источник правды один. */
export type BaseElement = Pick<
  CanvasElement,
  | 'id'
  | 'type'
  | 'x'
  | 'y'
  | 'angle'
  | 'opacity'
  | 'stroke'
  | 'fill'
  | 'strokeWidth'
  | 'seed'
  | 'order'
>;

export type { ElementData };

/**
 * Черновик — фигура, которую сейчас тащим мышью. Нет `id` (родится при коммите) и нет `order`
 * (z-index присваивается там же, при добавлении в документ). Превью рисуется из черновика.
 */
export type DraftElement = DistributiveOmit<CanvasElement, 'id' | 'order'>;

/**
 * Документ доски. `elements` — словарь (точечные апдейты дешевле массива), `elementIds` — порядок
 * отрисовки (z-index). Инвариант: `elements` и `elementIds` всегда синхронны. Серверный `order`
 * дублирует z-index числом (нужен, потому что PUT его требует), но источник порядка отрисовки —
 * по-прежнему `elementIds`; при гидрации массив восстанавливается сортировкой по `order`.
 */
export interface CanvasDocument {
  schemaVersion: number;
  elements: Record<string, CanvasElement>;
  elementIds: string[];
}
