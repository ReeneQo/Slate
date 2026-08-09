import type {
  BoardListItemResponse,
  BoardMemberResponse,
  BoardResponse,
} from '@slate/shared-types';

/**
 * Доменная модель доски на фронте — форма НА ПРОВОДЕ из контракта: `id`, `title`,
 * `createdAt`/`updatedAt` строками (JSON дат не знает, см. контракт). Форма `POST /boards`
 * (создание) — без `role`, отсюда и берёт её `createBoard`.
 *
 * Псевдоним, а не отдельный интерфейс: единственный источник правды о форме доски — схема в
 * @slate/shared-types, и дублировать её здесь значило бы завести второе место, обязанное
 * совпадать. Слои выше (feature, widget) импортируют `Board` отсюда, а не тип из пакета
 * напрямую — так «что такое доска» принадлежит entities, а не размазано по фичам.
 */
export type Board = BoardResponse;

/**
 * Доска в `GET /boards` (SLT-42/43) — `Board` плюс `role`: уровень доступа ТЕКУЩЕГО пользователя
 * (`owner`/`editor`/`viewer`). Единственная форма, в которой доска приходит СПИСКОМ — `getBoards`
 * возвращает именно её, а не голый `Board`. Список — потребитель группировки owned/shared
 * (features/board-list) и роль-гейта холста (widgets/canvas, через `useBoardRole`): `GET /boards`
 * остаётся единственным источником роли, отдельного эндпоинта под одну доску с ролью нет (SLT-43,
 * границы — не трогать бэк).
 */
export type BoardListItem = BoardListItemResponse;

/**
 * Участник доски на фронте — форма НА ПРОВОДЕ `GET/POST/PATCH /boards/:id/members` (SLT-42).
 * `role` здесь — `editor`/`viewer` (владелец в эту форму не попадает, см. контракт).
 */
export type BoardMember = BoardMemberResponse;
