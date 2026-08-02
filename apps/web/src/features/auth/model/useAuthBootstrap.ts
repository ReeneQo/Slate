import { useEffect } from 'react';

import { registerUnauthorizedHandler } from '@/shared/api';

import { useAuthStore } from './auth.store';
import { restoreSession } from './session';

/**
 * Bootstrap auth при старте приложения:
 *  1. Подключает onUnauthorized (SLT-24) → сброс auth-стора. БЕЗ императивного navigate из
 *     клиента: приватный роут сам вытолкнет на login по статусу (anonymous). Возвращённый
 *     unsubscribe снимаем в cleanup — не держим ссылку на обработчик после размонтирования.
 *  2. Один раз запускает восстановление сессии (`/me`).
 *
 * StrictMode (dev) вызывает эффект дважды — оба вызова идемпотентны: register замещает
 * единственный слот, restoreSession дважды приводит стор к тому же состоянию.
 */
export function useAuthBootstrap(): void {
  useEffect(() => {
    const unsubscribe = registerUnauthorizedHandler(() => {
      useAuthStore.getState().reset();
    });

    void restoreSession();

    return unsubscribe;
  }, []);
}
