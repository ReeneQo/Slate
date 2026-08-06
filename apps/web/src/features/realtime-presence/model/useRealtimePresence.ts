import { useEffect } from 'react';

import { useRealtimeStore } from './realtime.store';

/** Интервал прикладного heartbeat — согласован с серверным порогом офлайна (60с = 3 пропуска). */
const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Presence-цикл жизни доски (SLT-37): join на монтирование канвас-виджета, leave на
 * размонтирование — join/leave НЕ привязаны к connect/disconnect сокета (см. RealtimeBootstrap),
 * а к тому, какая доска сейчас открыта (SLT-33: один сокет, join/leave без реконнекта).
 *
 * Ре-джойн после обрыва сети — забота стора (см. socket.io.on('reconnect') в realtime.store),
 * здесь не дублируется: этот хук лишь один раз просит войти при монтировании.
 *
 * Отдельный хук от useCanvasSync (SLT-27) намеренно: presence — эфемерная ось, не документная,
 * useCanvasSync документ не трогает и про presence не знает.
 */
export function useRealtimePresence(boardId: string): void {
  useEffect(() => {
    const { joinBoard, leaveBoard } = useRealtimeStore.getState();
    joinBoard(boardId);

    const heartbeat = setInterval(() => {
      useRealtimeStore.getState().sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(heartbeat);
      leaveBoard(boardId);
    };
  }, [boardId]);
}
