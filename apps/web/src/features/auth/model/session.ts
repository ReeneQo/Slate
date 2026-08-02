import type { LoginInput, RegisterInput } from '@slate/shared-types';

import { getMe, login, logout, register } from '../api';
import { useAuthStore } from './auth.store';

/**
 * Оркестрация сессии: связывает api-обёртки со стором. Вынесена из стора, чтобы стор оставался
 * синхронным и тупым. Функции дёргают `useAuthStore.getState()` — вызываются и из React
 * (сабмит формы), и вне (bootstrap), поэтому не хуки.
 */

/**
 * ЕДИНЫЙ путь установки пользователя в стор — через `/me`. И при старте (восстановление), и
 * после свежего входа пользователь берётся из ОДНОГО эндпоинта, поэтому в сторе не бывает
 * «полу-пользователя». Это сознательно: login/register отдают минимальный AuthUserDto (без
 * hasPassword/createdAt), а форма стора — полный MeDto; фабриковать недостающее нельзя.
 */
async function hydrateFromMe(): Promise<void> {
  const me = await getMe();
  useAuthStore.getState().setAuthenticated(me);
}

/**
 * Восстановление сессии при старте. 200 → authenticated; любая ошибка → anonymous. 401 сверх
 * того дёрнет глобальный onUnauthorized (см. useAuthBootstrap) → тот же reset; повторный reset
 * идемпотентен. Не-401 (сеть/500) тоже ведём в anonymous: без валидной сессии продолжать
 * нельзя, а зависнуть в loading — хуже, чем честно показать вход.
 */
export async function restoreSession(): Promise<void> {
  try {
    await hydrateFromMe();
  } catch {
    useAuthStore.getState().reset();
  }
}

/** Вход: логин ставит session-куку, затем `/me` даёт каноничного пользователя в стор. */
export async function signIn(input: LoginInput): Promise<void> {
  await login(input);
  await hydrateFromMe();
}

/** Регистрация: создаёт аккаунт и сразу логинит (бэк открывает сессию), затем `/me`. */
export async function signUp(input: RegisterInput): Promise<void> {
  await register(input);
  await hydrateFromMe();
}

/**
 * Выход. Стор сбрасываем В ЛЮБОМ случае (`finally`): даже если logout ответил ошибкой (напр.
 * протухшая сессия), локально пользователь обязан оказаться разлогинен — иначе застрянет в
 * состоянии, из которого хотел выйти. Гвард по anonymous сам вытолкнет на login.
 */
export async function signOut(): Promise<void> {
  try {
    await logout();
  } finally {
    useAuthStore.getState().reset();
  }
}
