import type { ElementResponse, UpsertElementInput } from '@slate/shared-types';

import type { CanvasElement } from '../model/types';

/**
 * Маппинг между доменной моделью холста и контрактами бэка. Тривиален по построению: модель
 * (SLT-27) — это серверная фигура без серверного контекста, поэтому оба перехода — только
 * добавление/снятие нескольких полей, без переукладки геометрии. Именно ради этого модель
 * переехала на форму контракта (устранение дрейфа №2).
 */

/**
 * Клиентский элемент → тело создания (WS `element_create`, ранее — PUT-тело, SLT-39). id и
 * version уходят отдельно (id — в саму полезную нагрузку событий рядом с этим телом, version
 * контракту создания не нужна вовсе — оптимистическая блокировка есть только у update/delete).
 * boardId приходит из роута (`/boards/:id`, SLT-27 Р8), остальное совпадает поле-в-поле.
 * TypeScript проверяет полноту против UpsertElementInput — забытое поле не скомпилируется.
 */
export function toUpsertInput(element: CanvasElement, boardId: string): UpsertElementInput {
  const { id: _id, version: _version, ...rest } = element;
  return { ...rest, boardId };
}

/**
 * Ответ сервера → клиентский элемент (гидрация). Снимаем серверный контекст, которого модель не
 * держит: boardId (известен из роута), createdAt/updatedAt (рендеру не нужны). Остальное — та же
 * форма, что и в модели.
 *
 * `version` в ElementResponse нет вовсе — HTTP-контракт её сознательно прячет (SLT-38/39). `0`
 * здесь безопасный дефолт для только что созданных элементов (совпадает с дефолтом в БД), но НЕ
 * гарантированно верен для элемента с историей правок, которого не касалась ни одна WS-мутация
 * в этой сессии: первая же его правка рискует получить разовый `version_conflict` (баннер, без
 * потери данных — сервер отклонит запись, а не примет её вслепую). Полноценная синхронизация
 * версии после гидрации — вне границ SLT-39 (см. развилку в описании тикета), закрывается либо
 * в SLT-40, либо отдельным решением отдать version из GET-ответа.
 */
export function fromResponse(response: ElementResponse): CanvasElement {
  const { boardId: _boardId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = response;
  return { ...rest, version: 0 };
}
