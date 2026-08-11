import type { NormalizedProfile, OAuthMode, RawTokens } from './types';

/**
 * Общий контракт OAuth-провайдера. Абстрактный класс, а не интерфейс: конкретика
 * (authorize_url, headers, парсинг ответа) у каждого провайдера своя, а форма вызова —
 * общая, и `OAuthProviderRegistry`/`OAuthService` работают только через неё, не зная,
 * что за провайдер перед ними.
 *
 * Сейчас единственная реализация — GitHub (`GithubOAuthProvider`), но контракт рассчитан
 * на будущие провайдеры (Google/Telegram и т.п., вне этой таски): каждый новый — свой
 * класс-наследник и одна строка регистрации в `OAuthProviderRegistry`.
 */
export abstract class OAuthProvider {
  /** Ключ провайдера в реестре и в URL (`/oauth/connect/:provider`), напр. 'github'. */
  abstract readonly name: string;

  /**
   * Строит authorize-URL, на который фронт делает `window.location`. `mode` влияет
   * ТОЛЬКО на redirect_uri (см. реализацию у GitHub) — остальной набор параметров общий.
   */
  abstract getAuthUrl(state: string, mode: OAuthMode): string;

  /** Обмен временного `code` из callback на access token провайдера. */
  abstract exchangeCode(code: string, mode: OAuthMode): Promise<RawTokens>;

  /** Профиль пользователя по access token, приведённый к общему виду. */
  abstract fetchProfile(accessToken: string): Promise<NormalizedProfile>;
}
