/**
 * Пути element-эндпоинтов — `as const` ВНУТРИ entities: сущность владеет своими путями (как
 * board в SLT-26). Базовый префикс `/api` уже в клиенте (SLT-24), здесь только хвост.
 *
 * Мутации (`PUT`/`PATCH`/`DELETE /elements/:id`) с SLT-39 переехали на WS (см.
 * widgets/canvas/lib/useCanvasSync) — здесь остался только путь чтения: содержимое доски
 * грузится целиком при открытии холста (`/boards/:id/elements`, SLT-19), поэлементно элемент
 * никогда не запрашивается. Серверные HTTP-эндпоинты мутаций не тронуты — им ничего не запрещает
 * оставаться на бэке (тесты SLT-21, возможный batch), фронт просто больше не зовёт их.
 */
export const ELEMENT_ENDPOINTS = {
  /** `GET /boards/:id/elements` — все живые элементы доски (гидрация холста). */
  ofBoard: (boardId: string): string => `/boards/${boardId}/elements`,
} as const;
