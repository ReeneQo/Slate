import type { ReactElement } from 'react';

import { colorForUserId } from '@/shared/lib/color';

import { useRealtimeStore } from '../model/realtime.store';

/**
 * Аватары участников, сейчас онлайн на доске (SLT-37). Дедупликация мультивкладок одного юзера —
 * забота сервера (presence по userId, см. PresenceService), здесь просто отражаем список.
 *
 * Цвет аватара — тот же детерминированный `colorForUserId`, что и у курсора участника на холсте:
 * так один и тот же человек узнаётся по цвету в обоих местах.
 */
export function PresenceBar(): ReactElement | null {
  const onlineUsers = useRealtimeStore((state) => state.onlineUsers);

  if (onlineUsers.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-10 flex -space-x-2">
      {onlineUsers.map((user) => (
        <div
          key={user.userId}
          title={user.displayName}
          className="flex h-8 w-8 select-none items-center justify-center rounded-full border-2 border-white text-xs font-semibold uppercase text-white shadow"
          style={{ backgroundColor: colorForUserId(user.userId) }}
        >
          {user.displayName.charAt(0)}
        </div>
      ))}
    </div>
  );
}
