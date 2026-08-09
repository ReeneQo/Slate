import type {
  CreateBoardInput,
  InviteMemberInput,
  UpdateMemberRoleInput,
} from '@slate/shared-types';

import { request } from '@/shared/api';

import type { Board, BoardListItem, BoardMember } from '../model/types';
import { BOARD_ENDPOINTS } from './endpoints';

/**
 * Обёртки board-API поверх доменно-нейтрального `request<T>` (SLT-24). Функции, не класс: у
 * board-API нет состояния, инкапсулировать нечего. Типы ввода/вывода — из контракта
 * (@slate/shared-types), форма доски — доменный `Board`/`BoardListItem` (псевдонимы контракта).
 *
 * Здесь заканчивается ответственность entities: «как позвать бэк». Кэширование и инвалидация —
 * забота фичи (react-query, SLT-26/43), тут о них ничего не знают.
 */

/**
 * Список досок пользователя — owned ∪ shared (SLT-42), каждая с ролью текущего юзера. `signal`
 * прокидываем из react-query: при уходе с экрана/смене ключа запрос отменяется, а не висит зря и
 * не обновляет размонтированный кэш.
 */
export function getBoards(signal?: AbortSignal): Promise<BoardListItem[]> {
  return request<BoardListItem[]>(BOARD_ENDPOINTS.root, { signal });
}

/**
 * Создание доски. `title` опционален — при отсутствии дефолт «Untitled» держит Postgres, не
 * клиент (см. контракт). Бэк отвечает 201 с телом новой доски (без `role` — создатель всегда
 * owner, отдельное поле для этого случая избыточно) — возвращаем её, чтобы вызывающий мог сразу
 * перейти на неё.
 */
export function createBoard(input: CreateBoardInput): Promise<Board> {
  return request<Board>(BOARD_ENDPOINTS.root, { method: 'POST', json: input });
}

/** Удаление доски. Бэк отвечает 204 No Content — тела нет, поэтому `request<void>`. */
export function deleteBoard(id: string): Promise<void> {
  return request<void>(BOARD_ENDPOINTS.byId(id), { method: 'DELETE' });
}

/**
 * Список участников доски (SLT-42/43) — owner∪editor∪viewer видят (read, не управление). Владелец
 * в этот список НЕ входит (он не строка `BoardMember`, см. контракт) — представление владельца в
 * UI решает вызывающая фича своими средствами.
 */
export function getBoardMembers(boardId: string, signal?: AbortSignal): Promise<BoardMember[]> {
  return request<BoardMember[]>(BOARD_ENDPOINTS.members(boardId), { signal });
}

/** Пригласить существующего пользователя по email. owner-only на бэке — не-owner получит 404. */
export function inviteMember(boardId: string, input: InviteMemberInput): Promise<BoardMember> {
  return request<BoardMember>(BOARD_ENDPOINTS.members(boardId), { method: 'POST', json: input });
}

/** Сменить роль участника (editor↔viewer). owner-only. */
export function updateMemberRole(
  boardId: string,
  userId: string,
  input: UpdateMemberRoleInput,
): Promise<BoardMember> {
  return request<BoardMember>(BOARD_ENDPOINTS.member(boardId, userId), {
    method: 'PATCH',
    json: input,
  });
}

/** Отозвать участника. owner-only. Бэк отвечает 204 No Content. */
export function removeMember(boardId: string, userId: string): Promise<void> {
  return request<void>(BOARD_ENDPOINTS.member(boardId, userId), { method: 'DELETE' });
}
