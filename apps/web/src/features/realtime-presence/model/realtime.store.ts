import { create } from 'zustand';

import type { AppSocket, CursorPosition, PresenceUser } from '../lib/realtime.contracts';
import { createSocket } from '../lib/socket';
import {
  applyCursorLeave,
  applyCursorMove,
  applyPresenceJoin,
  applyPresenceLeave,
  applyPresenceSnapshot,
} from './presence-reducers';

export type RealtimeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface RemoteCursor extends PresenceUser {
  x: number;
  y: number;
}

interface RealtimeState {
  socket: AppSocket | null;
  status: RealtimeConnectionStatus;
  /** Доска, в комнату которой сокет сейчас вошёл (join_board без ответного leave_board). */
  activeBoardId: string | null;
  onlineUsers: PresenceUser[];
  /** Курсоры остальных участников активной доски, по userId. Свой курсор сюда не попадает —
   * сервер ретранслирует cursor_move только ОСТАЛЬНЫМ членам комнаты (см. CursorService). */
  cursors: Record<string, RemoteCursor>;
}

interface RealtimeActions {
  /** Один сокет на приложение (SLT-33/37): вызывается при переходе auth в authenticated. No-op,
   * если сокет уже есть — повторный connect() (например, StrictMode) не плодит второй инстанс. */
  connect: () => void;
  /** Разрывает сокет и полностью сбрасывает эфемерное состояние (логаут). */
  disconnect: () => void;
  /** Входит в комнату доски. Идемпотентно относительно presence/курсоров — список чужого
   * онлайна начинается с нуля до прихода снимка. */
  joinBoard: (boardId: string) => void;
  /** Выходит из комнаты доски (размонтирование канвас-виджета). No-op, если boardId не активен. */
  leaveBoard: (boardId: string) => void;
  sendHeartbeat: () => void;
  sendCursorMove: (position: CursorPosition) => void;
  sendCursorLeave: () => void;
}

export type RealtimeStore = RealtimeState & RealtimeActions;

const INITIAL: RealtimeState = {
  socket: null,
  status: 'disconnected',
  activeBoardId: null,
  onlineUsers: [],
  cursors: {},
};

/**
 * Realtime-стор (SLT-37): держит ОДИН сокет на приложение — не пересоздаётся при
 * открытии/закрытии доски (см. RealtimeBootstrap в app/providers, SLT-33: «один сокет,
 * join/leave без реконнекта при навигации»). Presence и курсоры — эфемерное состояние сессии,
 * НЕ persist, теряется на перезагрузку страницы (и должно — это не документ).
 *
 * Без immer: socket — несериализуемый объект (иммер-прокси поверх него был бы и бесполезен, и
 * рискован, попади стор случайно под persist/devtools-мидлварь позже), апдейты здесь и так
 * плоские замены массива/объекта.
 */
export const useRealtimeStore = create<RealtimeStore>((set, get) => ({
  ...INITIAL,

  connect: () => {
    if (get().socket) return;

    const socket = createSocket();

    socket.on('connect', () => set({ status: 'connected' }));
    socket.on('disconnect', () => set({ status: 'disconnected' }));

    // Manager-уровневые события реконнекта (НЕ путать с socket.on('connect') — тот стреляет и на
    // первом подключении). 'reconnect' — единственная точка ре-джойна активной доски: сервер на
    // дисконнект чистит presence/room-членство (см. RealtimeGateway.disconnecting), так что без
    // явного повторного join_board юзер молча выпадет из presence/курсоров после моргания сети.
    socket.io.on('reconnect_attempt', () => set({ status: 'reconnecting' }));
    socket.io.on('reconnect', () => {
      const { activeBoardId, joinBoard } = get();
      if (activeBoardId) joinBoard(activeBoardId);
    });

    socket.on('presence_snapshot', (payload) => set(applyPresenceSnapshot(payload)));
    socket.on('presence_join', (user) =>
      set((state) => applyPresenceJoin(state.onlineUsers, user)),
    );
    socket.on('presence_leave', (payload) =>
      set((state) => applyPresenceLeave(state.onlineUsers, state.cursors, payload)),
    );
    socket.on('cursor_move', (cursor) =>
      set((state) => applyCursorMove(state.cursors, state.onlineUsers, cursor)),
    );
    socket.on('cursor_leave', (payload) =>
      set((state) => applyCursorLeave(state.cursors, payload)),
    );

    set({ socket, status: 'connecting' });
    socket.connect();
  },

  disconnect: () => {
    get().socket?.disconnect();
    set({ ...INITIAL });
  },

  joinBoard: (boardId) => {
    const { socket } = get();
    // Сбрасываем онлайн-список/курсоры ДО ответа сервера: предыдущий снимок принадлежал другой
    // доске (или его вообще не было) и не должен на мгновение показаться актуальным для новой.
    set({ activeBoardId: boardId, onlineUsers: [], cursors: {} });
    socket?.emit('join_board', { boardId }, (result) => {
      // `board_not_found` (доска удалена/чужая) молча оставляет presence пустым — отдельного UI-
      // канала для отказа входа в комнату в этой задаче нет; HTTP-гидрация доски (SLT-27) уже
      // покажет свою ошибку по тому же поводу.
      if (!result.ok) {
        set((state) => (state.activeBoardId === boardId ? { activeBoardId: null } : state));
      }
    });
  },

  leaveBoard: (boardId) => {
    const { socket, activeBoardId } = get();
    if (activeBoardId !== boardId) return;
    socket?.emit('leave_board', { boardId });
    set({ activeBoardId: null, onlineUsers: [], cursors: {} });
  },

  sendHeartbeat: () => {
    const { socket } = get();
    if (socket?.connected) socket.emit('presence_ping');
  },

  sendCursorMove: (position) => {
    const { socket } = get();
    if (socket?.connected) socket.emit('cursor_move', position);
  },

  sendCursorLeave: () => {
    const { socket } = get();
    if (socket?.connected) socket.emit('cursor_leave');
  },
}));
