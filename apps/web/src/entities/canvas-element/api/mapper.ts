import type { ElementResponse, UpsertElementInput } from '@slate/shared-types';

import type { CanvasElement } from '../model/types';

/**
 * Маппинг между доменной моделью холста и контрактами бэка. Тривиален по построению: модель
 * (SLT-27) — это серверная фигура без серверного контекста, поэтому оба перехода — только
 * добавление/снятие нескольких полей, без переукладки геометрии. Именно ради этого модель
 * переехала на форму контракта (устранение дрейфа №2).
 */

/**
 * Клиентский элемент → тело `PUT /elements/:id`. id уходит в URL (в теле его нет), boardId
 * приходит из роута (`/boards/:id`, SLT-27 Р8), остальное совпадает поле-в-поле. TypeScript
 * проверяет полноту против UpsertElementInput — забытое поле не скомпилируется.
 */
export function toUpsertInput(element: CanvasElement, boardId: string): UpsertElementInput {
  const { id: _id, ...rest } = element;
  return { ...rest, boardId };
}

/**
 * Ответ сервера → клиентский элемент (гидрация). Снимаем серверный контекст, которого модель не
 * держит: boardId (известен из роута), createdAt/updatedAt (рендеру не нужны). Остальное — та же
 * форма, что и в модели.
 */
export function fromResponse(response: ElementResponse): CanvasElement {
  const { boardId: _boardId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = response;
  return rest;
}
