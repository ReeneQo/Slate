/**
 * Эфемерные типы OAuth-хендшейка. НЕ shared-types: границу фронт/бэк не пересекают —
 * `NormalizedProfile` целиком остаётся на бэке (резолв входа, SLT-54), наружу уходит уже
 * готовая сессия/ошибка, а не сам профиль.
 */

/**
 * `login` — обычный вход/регистрация через провайдера.
 * `link` — привязка провайдера к уже существующему аккаунту (SLT-56). Здесь только
 * развилка redirect_uri в провайдере — сам флоу линковки не реализован.
 */
export type OAuthMode = 'login' | 'link';

/**
 * Результат обмена code→token. НЕ персистится (SLT-50: токены не храним) и не покидает
 * providers/ — используется ровно один раз, между exchangeCode и fetchProfile.
 */
export interface RawTokens {
  accessToken: string;
}

/**
 * Профиль пользователя, нормализованный к единому виду независимо от провайдера. БЕЗ
 * токенов — резолв входа (SLT-54) работает только с этими полями.
 */
export interface NormalizedProfile {
  /** Имя провайдера, напр. 'github'. */
  provider: string;
  /** Идентификатор пользователя У ПРОВАЙДЕРА (не наш User.id). Всегда строка. */
  providerAccountId: string;
  /** null, если провайдер не отдал ни одного верифицируемого email. */
  email: string | null;
  /** true только если email пришёл из записи с verified === true. */
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}
