import type { ElementType, Prisma } from '@slate/database';

import type { ElementEntity } from '../entities/element.entity';

/**
 * Форма элемента холста, уходящая на фронт. Переехала сюда из board-модуля (SLT-20) ровно
 * так, как там и планировалось: пока единственным потребителем было чтение контента доски,
 * DTO жил рядом с ним; теперь у элемента есть собственные мутации, и владелец контракта —
 * element-модуль. `GET /boards/:id/elements` импортирует DTO отсюда, а не держит свою копию:
 * иначе один и тот же элемент имел бы две формы ответа, и они разъехались бы на первом же
 * новом поле — молча, потому что оба маппера продолжали бы компилироваться.
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
 * `deletedAt` в контракте отсутствует — его нет и в выборке (см. ELEMENT_SELECT). `version`
 * в выборке ЕСТЬ (SLT-38, нужен WS-оптимистической блокировке), но в этот DTO не попадает —
 * `toElementDto` ниже перечисляет поля поимённо и `version` среди них нет. HTTP-контракт
 * элемента им сознательно не пополняется; WS-контракт (SLT-38) отдаёт version через свой
 * собственный маппер `toElementSyncDto` в realtime-модуле, а не через этот.
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
 * Маппер сущность → DTO. Как и у доски, поля перечислены поимённо: `version` (теперь есть в
 * ELEMENT_SELECT, SLT-38) и `deletedAt` намеренно не попадают в HTTP-ответ. `deletedAt` не
 * нужен вовсе (выборка и так только живые элементы), `version` нужен, но другому потребителю —
 * WS-контракту (см. toElementSyncDto в realtime-модуле), не этому DTO.
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
