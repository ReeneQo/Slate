import type { CreateBoardInput } from '@slate/shared-types';

import { request } from '@/shared/api';

import type { Board } from '../model/types';
import { BOARD_ENDPOINTS } from './endpoints';

/**
 * Обёртки board-API поверх доменно-нейтрального `request<T>` (SLT-24). Функции, не класс: у
 * board-API нет состояния, инкапсулировать нечего. Типы ввода/вывода — из контракта
 * (@slate/shared-types), форма доски — доменный `Board` (псевдоним контракта).
 *
 * Здесь заканчивается ответственность entities: «как позвать бэк». Кэширование и инвалидация —
 * забота фичи (react-query, SLT-26), тут о них ничего не знают.
 */

/**
 * Список досок пользователя. `signal` прокидываем из react-query: при уходе с экрана/смене
 * ключа запрос отменяется, а не висит зря и не обновляет размонтированный кэш.
 */
export function getBoards(signal?: AbortSignal): Promise<Board[]> {
  return request<Board[]>(BOARD_ENDPOINTS.root, { signal });
}

/**
 * Создание доски. `title` опционален — при отсутствии дефолт «Untitled» держит Postgres, не
 * клиент (см. контракт). Бэк отвечает 201 с телом новой доски — возвращаем её, чтобы вызывающий
 * мог сразу перейти на неё.
 */
export function createBoard(input: CreateBoardInput): Promise<Board> {
  return request<Board>(BOARD_ENDPOINTS.root, { method: 'POST', json: input });
}

/** Удаление доски. Бэк отвечает 204 No Content — тела нет, поэтому `request<void>`. */
export function deleteBoard(id: string): Promise<void> {
  return request<void>(BOARD_ENDPOINTS.byId(id), { method: 'DELETE' });
}
