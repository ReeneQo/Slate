import type { ElementResponse } from '@slate/shared-types';

import { request } from '@/shared/api';

import type { CanvasElement } from '../model/types';
import { ELEMENT_ENDPOINTS } from './endpoints';
import { fromResponse } from './mapper';

/**
 * Обёртка HTTP-гидрации поверх доменно-нейтрального `request<T>` (SLT-24). Мутации элемента
 * (create/update/delete) с SLT-39 уезжают по WS (см. widgets/canvas/lib/useCanvasSync) —
 * здесь остаётся только чтение: холст рисует то, что уже пришло по сети, а не наоборот.
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
