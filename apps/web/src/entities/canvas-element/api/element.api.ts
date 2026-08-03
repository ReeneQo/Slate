import type { ElementResponse, PatchElementInput } from '@slate/shared-types';

import { request } from '@/shared/api';

import type { CanvasElement } from '../model/types';
import { ELEMENT_ENDPOINTS } from './endpoints';
import { fromResponse, toUpsertInput } from './mapper';

/**
 * Обёртки element-API поверх доменно-нейтрального `request<T>` (SLT-24). Функции, не класс: у
 * element-API нет состояния. Тела запросов — контракты из @slate/shared-types; здесь
 * заканчивается «как позвать бэк», оркестрация (когда и на что реагировать) — в widgets/canvas.
 *
 * Поток односторонний (store → сервер): ответы PUT/PATCH серверу возвращаются, но клиент их НЕ
 * применяет к стору (стор — источник правды рендера). Возврат тела оставлен на будущее (реалтайм,
 * этап 3), сейчас вызывающий его игнорирует.
 */

/**
 * Все живые элементы доски — гидрация холста при открытии. `signal` из react-query/AbortController:
 * при уходе с доски запрос отменяется. На выходе уже доменные CanvasElement (маппинг здесь, не у
 * потребителя).
 */
export async function getBoardElements(
  boardId: string,
  signal?: AbortSignal,
): Promise<CanvasElement[]> {
  const elements = await request<ElementResponse[]>(ELEMENT_ENDPOINTS.ofBoard(boardId), { signal });
  return elements.map(fromResponse);
}

/** Создание/замена фигуры целиком (autosave новой фигуры). id — в URL, boardId — в теле. */
export function putElement(element: CanvasElement, boardId: string): Promise<ElementResponse> {
  return request<ElementResponse>(ELEMENT_ENDPOINTS.byId(element.id), {
    method: 'PUT',
    json: toUpsertInput(element, boardId),
  });
}

/** Частичное изменение фигуры (autosave перемещения — патч x/y). */
export function patchElement(id: string, patch: PatchElementInput): Promise<ElementResponse> {
  return request<ElementResponse>(ELEMENT_ENDPOINTS.byId(id), { method: 'PATCH', json: patch });
}

/** Удаление фигуры (soft delete на бэке). 204 — тела нет. */
export function deleteElement(id: string): Promise<void> {
  return request<void>(ELEMENT_ENDPOINTS.byId(id), { method: 'DELETE' });
}
