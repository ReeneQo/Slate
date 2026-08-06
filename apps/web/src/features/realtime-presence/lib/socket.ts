import { io } from 'socket.io-client';

import { SOCKET_URL } from '@/shared/api';

import type { AppSocket } from './realtime.contracts';

/**
 * Фабрика сокета — создаёт, но НЕ подключает (`autoConnect: false`). Подключение вызывается явно
 * из realtime-стора (`connect()`), синхронизированного со статусом auth (см. useRealtimeConnection
 * в app/providers) — сокет не должен сам решать, когда ему жить.
 *
 * `withCredentials: true` — сессия едет той же куки-схемой, что и HTTP (вариант A, SLT-32): без
 * этого флага кука не долетит в handshake кросс-origin дева (Vite 5173 → Nest 3000).
 */
export function createSocket(): AppSocket {
  return io(SOCKET_URL, {
    withCredentials: true,
    autoConnect: false,
  });
}
