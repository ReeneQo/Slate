import type {
  CursorMovePayload,
  PresenceDeltaPayload,
  PresenceJoinPayload,
  PresenceSnapshotPayload,
  PresenceUser,
} from '../lib/realtime.contracts';
import type { RemoteCursor } from './realtime.store';

/**
 * Чистые редьюсеры presence/курсоров, вынесенные из socket.on-колбэков realtime-стора (SLT-37)
 * специально ради юнит-тестируемости: каждый — функция состояния и события в патч состояния, без
 * zustand/socket.io внутри. Стор (`realtime.store.ts`) лишь оборачивает их в `set((state) => ...)`.
 */

export function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** Снимок ПОЛНОСТЬЮ заменяет онлайн-список — это не дельта, а текущее состояние доски целиком. */
export function applyPresenceSnapshot(payload: PresenceSnapshotPayload): {
  onlineUsers: PresenceSnapshotPayload['users'];
} {
  return { onlineUsers: payload.users };
}

/** Дедуп по userId: повторный join того же участника (гонка snapshot/join) не плодит дубликат. */
export function applyPresenceJoin(
  onlineUsers: PresenceJoinPayload[],
  user: PresenceJoinPayload,
): { onlineUsers: PresenceJoinPayload[] } {
  if (onlineUsers.some((existing) => existing.userId === user.userId)) {
    return { onlineUsers };
  }
  return { onlineUsers: [...onlineUsers, user] };
}

/** Юзер офлайн ⇒ убираем и из онлайна, и его курсор — даже без отдельного cursor_leave. */
export function applyPresenceLeave(
  onlineUsers: PresenceJoinPayload[],
  cursors: Record<string, RemoteCursor>,
  payload: PresenceDeltaPayload,
): { onlineUsers: PresenceJoinPayload[]; cursors: Record<string, RemoteCursor> } {
  return {
    onlineUsers: onlineUsers.filter((user) => user.userId !== payload.userId),
    cursors: withoutKey(cursors, payload.userId),
  };
}

/**
 * `cursor_move` несёт только `{ userId, x, y }` — БЕЗ displayName (см. CursorMovePayload на
 * сервере: имя там было бы избыточным на высокочастотном потоке). Подпись курсора резолвится
 * здесь же, из уже известного онлайн-списка (presence приходит раньше первого движения курсора).
 * Не нашёлся (гонка) ⇒ падаем на уже закэшированное в предыдущем курсоре имя, а если и его нет —
 * на userId, лишь бы подпись не пропала совсем.
 */
export function applyCursorMove(
  cursors: Record<string, RemoteCursor>,
  onlineUsers: PresenceUser[],
  cursor: CursorMovePayload,
): { cursors: Record<string, RemoteCursor> } {
  const displayName =
    onlineUsers.find((user) => user.userId === cursor.userId)?.displayName ??
    cursors[cursor.userId]?.displayName ??
    cursor.userId;

  return {
    cursors: {
      ...cursors,
      [cursor.userId]: { userId: cursor.userId, displayName, x: cursor.x, y: cursor.y },
    },
  };
}

export function applyCursorLeave(
  cursors: Record<string, RemoteCursor>,
  payload: PresenceDeltaPayload,
): { cursors: Record<string, RemoteCursor> } {
  return { cursors: withoutKey(cursors, payload.userId) };
}
