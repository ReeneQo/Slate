import { isApiError } from '@/shared/api';

/**
 * Маппинг типизированной ошибки клиента (SLT-24) в текст для пользователя.
 *
 * Клиент доменно-нейтрален и знает только HTTP-статус — СМЫСЛ статусу придаёт фича: 401 на
 * логине это «неверные креды», 409 на регистрации — «email занят». Один и тот же статус в разных
 * сценариях значит разное, поэтому мапперы раздельные.
 *
 * Текст бэка (payload) наружу НЕ показываем: он технический, а на 500 может утечь лишнее — свои
 * пользовательские сообщения контролируем здесь.
 */

const GENERIC = 'Что-то пошло не так. Попробуйте ещё раз.';
const TOO_MANY_ATTEMPTS = 'Слишком много попыток. Попробуйте позже.';

/** Ошибка логина. 401 — неверные креды (сообщение нейтральное, не раскрывает, что не так). */
export function mapLoginError(error: unknown): string {
  if (!isApiError(error)) return GENERIC;

  switch (error.status) {
    case 401:
      return 'Неверный email или пароль';
    case 429:
      return TOO_MANY_ATTEMPTS;
    default:
      return GENERIC;
  }
}

/** Ошибка регистрации. 409 — email уже занят (ровно этот статус бросает AuthService). */
export function mapRegisterError(error: unknown): string {
  if (!isApiError(error)) return GENERIC;

  switch (error.status) {
    case 409:
      return 'Пользователь с таким email уже существует';
    case 429:
      return TOO_MANY_ATTEMPTS;
    default:
      return GENERIC;
  }
}
