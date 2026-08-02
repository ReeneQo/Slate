import type { UserResponse } from '@slate/shared-types';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * Статус сессии. Три состояния, а не булев `isAuthenticated`, потому что «ещё не знаю» —
 * отдельный, значащий случай:
 *  - `loading`   — идёт первый `/me` при старте. Гвард показывает загрузку: НЕ мигает формой
 *                  логина уже залогиненному и НЕ выкидывает на login до ответа сервера.
 *  - `authenticated` — есть пользователь.
 *  - `anonymous` — сессии нет (401 / нет куки) или разлогинились.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  /** Каноничный пользователь из `/me` (форма MeDto). `null`, пока не authenticated. */
  user: UserResponse | null;
}

interface AuthActions {
  /** Сессия подтверждена (`/me` при старте ИЛИ свежий вход): кладём каноничного пользователя. */
  setAuthenticated: (user: UserResponse) => void;
  /** Сессии нет: boot без куки, logout, onUnauthorized(401). Идемпотентно. */
  reset: () => void;
}

export type AuthStore = AuthState & AuthActions;

/** Стартуем в loading: до ответа `/me` мы не знаем, есть сессия или нет. */
const INITIAL: AuthState = { status: 'loading', user: null };

/**
 * Auth-стор на Zustand (паттерн канвас-сторов: immer-middleware, экшены как прямые мутации).
 * НЕ react-query: это состояние сессии, живущее весь рантайм и читаемое гвардом синхронно;
 * серверный кэш данных (доски) приедет на react-query в SLT-26.
 *
 * Стор держит только СОСТОЯНИЕ + синхронные сеттеры. Асинхронная оркестрация (login+`/me`,
 * восстановление, logout) — в model/session.ts, чтобы стор оставался «тупым» и тестируемым.
 */
export const useAuthStore = create<AuthStore>()(
  immer((set) => ({
    ...INITIAL,
    setAuthenticated: (user) =>
      set((state) => {
        state.status = 'authenticated';
        state.user = user;
      }),
    reset: () =>
      set((state) => {
        state.status = 'anonymous';
        state.user = null;
      }),
  })),
);
