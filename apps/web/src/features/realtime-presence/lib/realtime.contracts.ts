import type { Socket } from 'socket.io-client';

/**
 * Локальное зеркало серверных event-контрактов реалтайма (`apps/api/.../realtime.types.ts`,
 * SLT-35/36). НЕ shared-types: по прецеденту SLT-35/36 realtime-контракты живут в apps/api,
 * фронт дублирует минимально нужное здесь. Изменится форма события на сервере — эти типы нужно
 * поправить вручную, дрейф компилятор не поймает (это осознанный компромисс, см. SLT-37).
 */

export interface PresenceUser {
  userId: string;
  displayName: string;
}

export interface PresenceSnapshotPayload {
  users: PresenceUser[];
}

export type PresenceJoinPayload = PresenceUser;

export interface PresenceDeltaPayload {
  userId: string;
}

export interface CursorPosition {
  x: number;
  y: number;
}

export interface CursorMovePayload extends CursorPosition {
  userId: string;
}

export interface CursorLeavePayload {
  userId: string;
}

export interface BoardMembershipPayload {
  boardId: string;
}

export type BoardJoinResult = { ok: true } | { ok: false; reason: 'board_not_found' };

export interface ServerToClientEvents {
  presence_snapshot: (payload: PresenceSnapshotPayload) => void;
  presence_join: (payload: PresenceJoinPayload) => void;
  presence_leave: (payload: PresenceDeltaPayload) => void;
  cursor_move: (payload: CursorMovePayload) => void;
  cursor_leave: (payload: CursorLeavePayload) => void;
}

export interface ClientToServerEvents {
  join_board: (payload: BoardMembershipPayload, ack: (result: BoardJoinResult) => void) => void;
  leave_board: (payload: BoardMembershipPayload) => void;
  presence_ping: () => void;
  cursor_move: (payload: CursorPosition) => void;
  cursor_leave: () => void;
}

/** Типизированный сокет приложения — дженерики те же, что у серверного AppSocket. */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
