/**
 * Маппинг redirect-кодов OAuth (SLT-52/56) в текст для пользователя. В отличие от mapAuthError —
 * здесь вход не `ApiError` из транспорта, а голый код из query-параметра `?error=`, который
 * бэк-контроллер сам приклеивает к redirect URL (см. `mapOAuthErrorToCode`/`mapOAuthLinkErrorToCode`
 * в auth.controller.ts). Отдельный файл, а не расширение mapAuthError: разная форма входа —
 * разный контракт функции.
 */

const GENERIC = 'Что-то пошло не так. Попробуйте позже.';

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  noEmail:
    'GitHub не предоставил email. Сделайте email публичным в настройках GitHub или зарегистрируйтесь по паролю.',
  emailNotVerified: 'Email в GitHub не подтверждён. Подтвердите его в GitHub и повторите.',
  emailConflict: 'Этот email уже зарегистрирован. Войдите паролем.',
  oauthFailed: 'Не удалось войти через GitHub. Попробуйте ещё раз.',
  serverError: GENERIC,
};

/** Код `?error=` на `/login` после неудачного OAuth-входа. Неизвестный код → текст serverError. */
export function mapOAuthLoginErrorCode(code: string): string {
  return LOGIN_ERROR_MESSAGES[code] ?? GENERIC;
}

const LINK_ERROR_MESSAGES: Record<string, string> = {
  alreadyLinked: 'Этот GitHub уже привязан к другому аккаунту',
  oauthFailed: 'Не удалось привязать GitHub. Попробуйте ещё раз.',
  serverError: GENERIC,
};

/** Код `?error=` на `/` после неудачной привязки GitHub. Неизвестный код → текст serverError. */
export function mapOAuthLinkErrorCode(code: string): string {
  return LINK_ERROR_MESSAGES[code] ?? GENERIC;
}

/** Текст успешной привязки (`?linked=github` на `/`) — единственный вариант, маппинга не требует. */
export const OAUTH_LINK_SUCCESS_MESSAGE = 'GitHub привязан';
