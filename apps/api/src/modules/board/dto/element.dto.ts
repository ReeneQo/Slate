import type { ElementType, Prisma } from '@slate/database';

import type { ElementEntity } from '../entities/element.entity';

/**
 * Форма элемента холста, уходящая на фронт. Определена ЗДЕСЬ, в board-модуле, потому что
 * единственный её потребитель сейчас — чтение контента доски (`GET /boards/:id/elements`).
 * Мутации отдельных элементов — SLT-20; когда появится element-модуль, DTO и маппер
 * переедут к нему, а этот эндпоинт станет их импортировать. Ход именно такой, а не наоборот:
 * заводить модуль под один эндпоинт чтения — это структура, опережающая содержание.
 *
 * `type` и `data` типизированы через `import type` из @slate/database, а не своими копиями.
 * Импорт типовой, то есть исчезает при компиляции — рантайм-зависимости от ORM у контракта
 * не появляется, зато `ElementType` не может разъехаться со схемой (добавили фигуру в enum —
 * DTO знает о ней сразу). Копия union'а `'rect' | 'ellipse' | 'line'` разъехалась бы молча.
 *
 * `data` — геометрия, зависящая от типа фигуры (width/height у прямоугольника, points у
 * линии), в схеме это jsonb. `Prisma.JsonValue` информативнее `unknown` (клиент знает, что
 * там именно JSON) и безопаснее `any` — сузить его всё равно придётся явно. Настоящую
 * проверку формы даст zod-схема в packages/shared-types, когда контракты туда переедут.
 *
 * `version` и `deletedAt` в контракте отсутствуют — их нет и в выборке (см. ELEMENT_SELECT).
 */
export interface ElementDto {
  id: string;
  boardId: string;
  type: ElementType;
  x: number;
  y: number;
  angle: number;
  opacity: number;
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  seed: number;
  order: number;
  data: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Маппер сущность → DTO. Как и у доски, поля перечислены поимённо: `version` и `deletedAt`
 * не должны попасть в ответ, даже если однажды окажутся в ELEMENT_SELECT (а окажутся —
 * version понадобится этапу 3, deletedAt пригодится реалтайму для отмены удаления).
 */
export function toElementDto(element: ElementEntity): ElementDto {
  return {
    id: element.id,
    boardId: element.boardId,
    type: element.type,
    x: element.x,
    y: element.y,
    angle: element.angle,
    opacity: element.opacity,
    stroke: element.stroke,
    fill: element.fill,
    strokeWidth: element.strokeWidth,
    seed: element.seed,
    order: element.order,
    data: element.data,
    createdAt: element.createdAt,
    updatedAt: element.updatedAt,
  };
}
