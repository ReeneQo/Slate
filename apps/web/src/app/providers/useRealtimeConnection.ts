import { useEffect } from 'react';

import { useAuthStore } from '@/features/auth';
import { useRealtimeStore } from '@/features/realtime-presence';

/**
 * Соединяет статус auth-стора с realtime-сокетом (SLT-37). Живёт на уровне app, а не в
 * какой-то из фич: и auth, и realtime-presence — независимые features (по FSD-границам фича не
 * импортирует другую фичу), а решение «когда сокету жить» опирается на обе разом. Композиция
 * двух фич — ровно то, для чего существует app-слой.
 *
 * Presence-сокет — свойство ЗАЛОГИНЕННОГО юзера, не конкретной доски: коннект/дисконнект здесь,
 * join/leave комнаты — отдельно, по монтированию канвас-виджета (useRealtimePresence).
 */
export function useRealtimeConnection(): void {
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status === 'authenticated') {
      useRealtimeStore.getState().connect();
    } else if (status === 'anonymous') {
      useRealtimeStore.getState().disconnect();
    }
    // 'loading' — сессия ещё не разрешена, сокету рано решать что-либо.
  }, [status]);
}
