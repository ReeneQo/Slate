import type { PatchElementInput, UpsertElementInput } from '@slate/shared-types';
import type { Socket } from 'socket.io-client';

import type { CanvasElement } from '@/entities/canvas-element';

/**
 * Локальное зеркало серверных event-контрактов реалтайма (`apps/api/.../realtime.types.ts`,
 * SLT-35/36/38). НЕ shared-types: по прецеденту SLT-35/36 realtime-контракты живут в apps/api,
 * фронт дублирует минимально нужное здесь. Изменится форма события на сервере — эти типы нужно
 * поправить вручную, дрейф компилятор не поймает (это осознанный компромисс, см. SLT-37).
 *
 * Форма самого элемента в этих событиях (SLT-38/39) НЕ переписана заново: тело create/update
 * реиспользует `UpsertElementInput`/`PatchElementInput` из @slate/shared-types (тот же контракт,
 * которым уже была описана HTTP-мутация до переезда на WS), а «полный элемент» в ack/broadcast —
 * клиентскую модель `CanvasElement` (entities/canvas-element, SLT-39): она уже ровно та форма,
 * которую WS-канал кладёт в ack/broadcast (ElementDto + version, минус boardId/created/updatedAt,
 * которые клиенту не нужны).
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

/**
 * Payload `element_create`: полная форма фигуры (та же, что тело PUT — `UpsertElementInput`)
 * плюс клиентский `id` (на HTTP он едет в URL, здесь URL нет — только payload).
 */
export type ElementCreatePayload = UpsertElementInput & { id: string };

/** Payload `element_update`: адрес + изменения (форма PATCH-тела) + ожидаемая version. */
export interface ElementUpdatePayload {
  boardId: string;
  id: string;
  version: number;
  changes: PatchElementInput;
}

/** Payload `element_delete`: адрес + ожидаемая version — тела для удаления не требуется. */
export interface ElementDeletePayload {
  boardId: string;
  id: string;
  version: number;
}

/**
 * Причина отказа мутации в ack (см. сервер, `ElementMutationRejectReason`):
 *  - `access_denied` — сокет не в комнате доски из payload'а;
 *  - `forbidden` — сокет В КОМНАТЕ (доступ есть), но роль `viewer`: писать может только
 *    `editor`/`owner` (SLT-41, `canWrite`). Отдельно от `access_denied` — доска ВИДНА на чтение,
 *    просто прав на запись мало (SLT-43: собственная ветка баннера — «доступ изменён», не «не
 *    сохранено»);
 *  - `not_found` — элемент недоступен/не существует/удалён, либо доска исчезла;
 *  - `version_conflict` — update/delete: ожидаемая version устарела;
 *  - `conflict` — create: id занят элементом другой доски/типа;
 *  - `invalid_payload` — форма не прошла валидацию на сервере.
 */
export type ElementMutationRejectReason =
  | 'access_denied'
  | 'forbidden'
  | 'not_found'
  | 'version_conflict'
  | 'conflict'
  | 'invalid_payload';

/** Ack `element_create`. */
export type ElementCreateAckResult =
  | { ok: true; element: CanvasElement }
  | { ok: false; reason: Exclude<ElementMutationRejectReason, 'version_conflict'> };

/**
 * Ack `element_update`. `version_conflict` несёт актуальный элемент — SLT-39 сознательно НЕ
 * применяет его к стору (это был бы refetch-and-reapply, отложенный на SLT-40); здесь только
 * баннер (см. useCanvasSync).
 */
export type ElementUpdateAckResult =
  | { ok: true; element: CanvasElement }
  | { ok: false; reason: 'version_conflict'; element: CanvasElement }
  | { ok: false; reason: Exclude<ElementMutationRejectReason, 'version_conflict' | 'conflict'> };

/** Ack `element_delete`. Успех несёт не элемент, а id/version — удалённой фигуре нечего слать. */
export type ElementDeleteAckResult =
  | { ok: true; id: string; version: number }
  | { ok: false; reason: 'version_conflict'; element: CanvasElement }
  | { ok: false; reason: Exclude<ElementMutationRejectReason, 'version_conflict' | 'conflict'> };

/**
 * Broadcast `element_created`/`element_updated`: ПОЛНЫЙ элемент, не дельта (см. сервер,
 * `ElementBroadcastPayload`). `userId` — метаданные автора, НЕ механизм анти-эха: анти-эхо даёт
 * `socket.to` на сервере (отправитель свой же broadcast не получает) — клиент НЕ фильтрует
 * входящее по userId (ловушка двух вкладок одного юзера, SLT-39 Р3).
 */
export interface ElementBroadcastPayload {
  element: CanvasElement;
  userId: string;
}

/** Broadcast `element_deleted`: id + новая version + автор — геометрии в нём уже нет. */
export interface ElementDeletedBroadcastPayload {
  id: string;
  version: number;
  userId: string;
}

export interface ServerToClientEvents {
  presence_snapshot: (payload: PresenceSnapshotPayload) => void;
  presence_join: (payload: PresenceJoinPayload) => void;
  presence_leave: (payload: PresenceDeltaPayload) => void;
  cursor_move: (payload: CursorMovePayload) => void;
  cursor_leave: (payload: CursorLeavePayload) => void;
  /** Мутация применена другим участником комнаты (SLT-38/39) — полный элемент, не дельта. */
  element_created: (payload: ElementBroadcastPayload) => void;
  element_updated: (payload: ElementBroadcastPayload) => void;
  element_deleted: (payload: ElementDeletedBroadcastPayload) => void;
}

export interface ClientToServerEvents {
  join_board: (payload: BoardMembershipPayload, ack: (result: BoardJoinResult) => void) => void;
  leave_board: (payload: BoardMembershipPayload) => void;
  presence_ping: () => void;
  cursor_move: (payload: CursorPosition) => void;
  cursor_leave: () => void;
  /** Создание/замена/воскрешение элемента (SLT-38/39) — ack обязателен, как у join_board. */
  element_create: (
    payload: ElementCreatePayload,
    ack: (result: ElementCreateAckResult) => void,
  ) => void;
  /** Версионированное частичное обновление элемента (SLT-38/39). */
  element_update: (
    payload: ElementUpdatePayload,
    ack: (result: ElementUpdateAckResult) => void,
  ) => void;
  /** Версионированное мягкое удаление элемента (SLT-38/39). */
  element_delete: (
    payload: ElementDeletePayload,
    ack: (result: ElementDeleteAckResult) => void,
  ) => void;
}

/** Типизированный сокет приложения — дженерики те же, что у серверного AppSocket. */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
