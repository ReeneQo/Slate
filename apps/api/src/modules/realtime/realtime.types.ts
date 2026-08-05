import type { Server, Socket } from 'socket.io';

/**
 * Типы транспорта realtime. Фундамент этапа 3 (SLT-32) — соединение и его аутентификация — плюс
 * первое содержательное событие: членство в комнате доски (SLT-33). Presence/курсоры (3.2) и
 * синхронизация элементов (3.3) наполнят карты дальше.
 *
 * Пустые карты по-прежнему типизированы как `Record<string, never>`, а НЕ пустым интерфейсом
 * `interface X {}`: eslint (`no-empty-object-type`) справедливо запрещает второе — пустой
 * интерфейс совместим с чем угодно и молча гасит типизацию. `Record<string, never>` же означает
 * ровно «событий пока нет» и при этом удовлетворяет ограничению `EventsMap` дженериков socket.io
 * (значение-`never` присваиваемо сигнатуре обработчика). Как только в карте появляется первое
 * событие, она становится именованным интерфейсом — так `ClientToServerEvents` ниже и вышла из
 * заглушки.
 */
export type ServerToClientEvents = Record<string, never>;
export type InterServerEvents = Record<string, never>;

/** Комната доски: `board:<boardId>`. Broadcast событий доски идёт только сюда, не глобально. */
export const boardRoom = (boardId: string): string => `board:${boardId}`;

/**
 * Полезная нагрузка `join_board`/`leave_board`. Один сокет живёт всё время сессии и по мере
 * открытия/закрытия досок входит и выходит из их комнат — без реконнекта на навигацию.
 */
export interface BoardMembershipPayload {
  boardId: string;
}

/**
 * Причина отказа во входе в комнату. ЕДИНСТВЕННАЯ и намеренно неразличающая «доски нет» и «доска
 * не твоя» — симметрично HTTP 404 board-слоя (см. boardNotFound): раздельные причины выдавали бы
 * посторонему, какие boardId существуют. Presence/sync добавят свои коды рядом, если понадобятся.
 */
export type BoardJoinDeniedReason = 'board_not_found';

/**
 * Результат `join_board`, едущий назад ack-callback'ом (а не отдельным `join_error`-событием):
 * клиент шлёт `join_board` с callback и в нём же получает исход. Дискриминированное объединение по
 * `ok` заставляет клиента разобрать отказ прежде, чем считать себя в комнате.
 */
export type BoardJoinResult = { ok: true } | { ok: false; reason: BoardJoinDeniedReason };

/**
 * События клиент→сервер. Пока ровно членство в комнате доски (SLT-33):
 *   - `join_board` несёт ack — вход авторизуется (см. BoardRoomService), и исход обязан вернуться;
 *   - `leave_board` без ack — выход из комнаты не может быть отклонён (проверять нечего) и
 *     идемпотентен, подтверждать нечего.
 */
export interface ClientToServerEvents {
  join_board: (payload: BoardMembershipPayload, ack: (result: BoardJoinResult) => void) => void;
  leave_board: (payload: BoardMembershipPayload) => void;
}

/**
 * Данные, привязанные к сокету на всё время соединения (`socket.data`).
 *
 * `userId` кладёт сюда ws-auth-middleware ПОСЛЕ успешной проверки сессии — анонимный сокет до
 * этой точки не доходит (соединение отклоняется на handshake). Поэтому поле обязательное, а не
 * опциональное: к моменту, когда до `socket.data` дотянется обработчик события, пользователь
 * уже гарантированно опознан. Presence этапа 3.2 добавит сюда свои поля рядом.
 */
export interface SocketData {
  userId: string;
}

/** Типизированный socket.io-сервер приложения. Дженерики фиксируют контракт событий и данных. */
export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Типизированный сокет одного клиента — с тем же контрактом, что и сервер. */
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
