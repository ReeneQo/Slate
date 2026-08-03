/**
 * Пути element-эндпоинтов — `as const` ВНУТРИ entities: сущность владеет своими путями (как
 * board в SLT-26). Базовый префикс `/api` уже в клиенте (SLT-24), здесь только хвост.
 *
 * Маршрут мутаций плоский (`/elements/:id`) — id элемента глобально уникален (uuid v7), доска в
 * пути ничего не адресует (см. ElementController на бэке). Чтение же — по доске
 * (`/boards/:id/elements`): содержимое грузится целиком при открытии холста (SLT-19), поэлементно
 * элемент никогда не запрашивается.
 */
export const ELEMENT_ENDPOINTS = {
  /** `PUT` / `PATCH` / `DELETE /elements/:id` — мутации конкретного элемента. */
  byId: (id: string): string => `/elements/${id}`,
  /** `GET /boards/:id/elements` — все живые элементы доски (гидрация холста). */
  ofBoard: (boardId: string): string => `/boards/${boardId}/elements`,
} as const;
