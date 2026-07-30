import type { Prisma } from '@slate/database';

/**
 * «Живой элемент» — единственное определение на приложение.
 *
 * У Element в схеме soft delete (SLT-13): удаление обратимо, поэтому строка остаётся, а
 * признак — `deletedAt IS NULL`. Знание опасно тем, что нужно КАЖДОМУ чтению элементов:
 * забыть фильтр — значит показать на холсте фигуры, которые пользователь удалил, причём
 * молча и только в одном эндпоинте. Названная константа делает пропуск заметным (её видно
 * в diff'е и в тестах), а `grep LIVE_ELEMENT_WHERE` даёт полный список мест, где правило
 * применено. Board-модуль берёт его отсюда импортом, а не копией.
 *
 * Правило живёт ТОЛЬКО в слое данных — в board.repository и element.repository. Выше по стеку
 * про мягкое удаление не знают: сервис просит «элемент», а не «элемент, у которого не выставлен
 * deletedAt». Единственное исключение заведено явно и называется себя выдающим именем
 * (`findInvariantsIncludingDeleted`) — воскрешение через PUT обязано видеть удалённую строку.
 *
 * Индекс под этот запрос в схеме уже есть: `@@index([boardId, deletedAt])`.
 */
export const LIVE_ELEMENT_WHERE = { deletedAt: null } as const satisfies Prisma.ElementWhereInput;

/**
 * Порядок отрисовки. `order` — дробный индекс (fractional indexing), то есть фактически
 * z-order: клиент обязан рисовать фигуры именно в этой последовательности, иначе одна и та
 * же доска выглядит по-разному у разных людей. Поэтому сортирует БД, а не клиент.
 *
 * Тай-брейк по `id` не перестраховка: `order` не unique, и при вставке двух элементов между
 * одними и теми же соседями значения могут совпасть. Без второго ключа Postgres вернёт такую
 * пару в произвольном порядке — и он будет РАЗНЫМ у разных клиентов. `id` (uuid v7) даёт
 * детерминированный порядок, к тому же примерно хронологический.
 */
export const ELEMENT_ORDER_BY: Prisma.ElementOrderByWithRelationInput[] = [
  { order: 'asc' },
  { id: 'asc' },
];

/**
 * Поля элемента, уходящие наружу. Как и у доски, ограничение живёт в SELECT, а не в типе:
 * `version` и `deletedAt` физически не попадают в рантайм-объект.
 *
 * `version` — счётчик ревизий под этап 3, клиенту пока нечего с ним делать. `deletedAt`
 * наружу не нужен вовсе: выборка и так возвращает только живые элементы, так что поле было
 * бы константным `null` в каждом ответе — байты, которые ничего не сообщают, зато приглашают
 * клиента написать собственную проверку удалённости вместо серверной.
 */
export const ELEMENT_SELECT = {
  id: true,
  boardId: true,
  type: true,
  x: true,
  y: true,
  angle: true,
  opacity: true,
  stroke: true,
  fill: true,
  strokeWidth: true,
  seed: true,
  order: true,
  data: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ElementSelect;

/** Элемент холста в том виде, в каком его видит сервис: без version и deletedAt. */
export type ElementEntity = Prisma.ElementGetPayload<{ select: typeof ELEMENT_SELECT }>;
