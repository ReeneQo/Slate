import type { Server, Socket } from 'socket.io';

/**
 * Типы транспорта realtime. Фундамент этапа 3 (SLT-32) — соединение и его аутентификация,
 * членство в комнате доски (SLT-33), Redis-broadcast (SLT-34) — плюс первая содержательная
 * фича поверх них: presence, реестр «кто онлайн» (SLT-35, 3.2). Курсоры и синхронизация
 * элементов (3.3) наполнят карты дальше.
 *
 * `InterServerEvents` по-прежнему `Record<string, never>`, а НЕ пустым интерфейсом
 * `interface X {}`: eslint (`no-empty-object-type`) справедливо запрещает второе — пустой
 * интерфейс совместим с чем угодно и молча гасит типизацию. `Record<string, never>` же означает
 * ровно «событий пока нет» и при этом удовлетворяет ограничению `EventsMap` дженериков socket.io.
 * Инстансы не шлют друг другу событий через этот канал напрямую — координацию между ними несёт
 * Redis-адаптер (SLT-34), прозрачно поверх обычных `server.to(room).emit`/`socket.to(room).emit`.
 */
export type InterServerEvents = Record<string, never>;

const BOARD_ROOM_PREFIX = 'board:';

/** Комната доски: `board:<boardId>`. Broadcast событий доски идёт только сюда, не глобально. */
export const boardRoom = (boardId: string): string => `${BOARD_ROOM_PREFIX}${boardId}`;

/**
 * Обратное к `boardRoom`: достаёт boardId из имени комнаты socket.io, или `null`, если это не
 * комната доски (например, собственная room-по-id, которую socket.io заводит на каждый сокет).
 *
 * Нужна presence (SLT-35) и её серверному тику: чтобы почистить/просканировать состояние сокета
 * по всем доскам, которыми он владеет, единственный источник правды — `socket.rooms` (сам
 * socket.io), а не отдельный реестр `room → boardId` — заводить его специально было бы
 * дублированием того, что уже знает транспорт.
 */
export function boardIdFromRoom(room: string): string | null {
  return room.startsWith(BOARD_ROOM_PREFIX) ? room.slice(BOARD_ROOM_PREFIX.length) : null;
}

/** boardId всех комнат-досок из набора комнат сокета (свою id-комнату и не-board строки отсеивает). */
export function boardIdsFromRooms(rooms: Iterable<string>): string[] {
  const boardIds: string[] = [];

  for (const room of rooms) {
    const boardId = boardIdFromRoom(room);

    if (boardId !== null) {
      boardIds.push(boardId);
    }
  }

  return boardIds;
}

/**
 * Полезная нагрузка `join_board`/`leave_board`. Один сокет живёт всё время сессии и по мере
 * открытия/закрытия досок входит и выходит из их комнат — без реконнекта на навигацию.
 */
export interface BoardMembershipPayload {
  boardId: string;
}

/**
 * Достаёт boardId из недоверенного payload события. `null` ⇒ payload не той формы (не объект,
 * нет поля, не строка, пустая строка) — вызывающий трактует это как «доски нет».
 *
 * Общая для двух потребителей (SLT-35): `BoardRoomService` (членство) и `PresenceService`
 * (онлайн-реестр) разбирают ОДИН и тот же payload `join_board`/`leave_board` независимо друг от
 * друга — каждый через этот единый парсер, а не через приватную копию. Так оба свежие правила
 * «кривой ввод не долетает до Redis/Prisma» проверяются в одном месте и не расходятся.
 */
export function extractBoardId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { boardId } = payload as { boardId?: unknown };

  return typeof boardId === 'string' && boardId.length > 0 ? boardId : null;
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

/** Снимок онлайна доски, едущий входящему сокету единожды — сразу после успешного `join_board`. */
export interface PresenceSnapshotPayload {
  userIds: string[];
}

/** Дельта presence: конкретный userId стал онлайн (`presence_join`) или офлайн (`presence_leave`). */
export interface PresenceDeltaPayload {
  userId: string;
}

/**
 * События клиент→сервер (SLT-33/35):
 *   - `join_board` несёт ack — вход авторизуется (см. BoardRoomService), и исход обязан вернуться;
 *   - `leave_board` без ack — выход из комнаты не может быть отклонён (проверять нечего) и
 *     идемпотентен, подтверждать нечего;
 *   - `presence_ping` — прикладной heartbeat presence (см. PresenceService), без payload: клиент
 *     сигналит «я жив» на все доски, в комнатах которых сейчас состоит его сокет, разом. Ожидаемый
 *     интервал на клиенте — 20с (SLT-37); порог офлайна на сервере — 60с (3 пропуска).
 */
export interface ClientToServerEvents {
  join_board: (payload: BoardMembershipPayload, ack: (result: BoardJoinResult) => void) => void;
  leave_board: (payload: BoardMembershipPayload) => void;
  presence_ping: () => void;
}

/**
 * События сервер→клиент (SLT-35). Все три — presence:
 *   - `presence_snapshot` — единичный снимок текущего онлайна доски, входящему сокету при join;
 *   - `presence_join`/`presence_leave` — дельты по userId (не по сокету), когда юзер целиком
 *     переходит между офлайном и онлайном (см. PresenceService про 0→1/1→0 на уровне userId).
 */
export interface ServerToClientEvents {
  presence_snapshot: (payload: PresenceSnapshotPayload) => void;
  presence_join: (payload: PresenceDeltaPayload) => void;
  presence_leave: (payload: PresenceDeltaPayload) => void;
}

/**
 * Данные, привязанные к сокету на всё время соединения (`socket.data`).
 *
 * `userId` кладёт сюда ws-auth-middleware ПОСЛЕ успешной проверки сессии — анонимный сокет до
 * этой точки не доходит (соединение отклоняется на handshake). Поэтому поле обязательное, а не
 * опциональное: к моменту, когда до `socket.data` дотянется обработчик события, пользователь
 * уже гарантированно опознан.
 *
 * `sessionGen` (SLT-35) — снимок поколения сессии (SLT-31) на момент handshake, той же природы,
 * что и `req.session.sessionGen`: middleware кладёт его сюда РЯДОМ с userId, одним снимком с одного
 * чтения сессии. Серверный presence-тик сверяет его с актуальным поколением в Redis и рвёт сокет
 * при расхождении (logout-everywhere должен реально закрывать соединение, а не только сбрасывать
 * пользователя из presence по TTL). Обязательное по той же причине, что и userId.
 */
export interface SocketData {
  userId: string;
  sessionGen: number;
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
