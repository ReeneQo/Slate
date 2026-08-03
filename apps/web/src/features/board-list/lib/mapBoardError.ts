import { isApiError } from '@/shared/api';

/**
 * Маппинг типизированной ошибки клиента (SLT-24) в текст для пользователя — тот же приём, что у
 * auth (mapAuthError): клиент знает лишь HTTP-статус, СМЫСЛ статусу придаёт фича.
 *
 * Текст бэка (payload) наружу НЕ показываем: он технический, а на 5xx может утечь лишнее.
 * 401 здесь не разбираем — им занимается глобальный onUnauthorized (SLT-25): сессия истекла,
 * стор сбросится, гвард уведёт на login, экран досок просто размонтируется.
 */

const GENERIC = 'Не удалось загрузить доски. Попробуйте ещё раз.';

/** Ошибка загрузки списка досок. */
export function mapBoardListError(error: unknown): string {
  if (isApiError(error) && error.status === 429) {
    return 'Слишком много запросов. Попробуйте позже.';
  }
  return GENERIC;
}

/** Ошибка создания/удаления доски. 404 при удалении — доска уже удалена (напр. в другой вкладке). */
export function mapBoardMutationError(error: unknown): string {
  if (!isApiError(error)) return 'Что-то пошло не так. Попробуйте ещё раз.';

  switch (error.status) {
    case 404:
      return 'Доска не найдена — возможно, она уже удалена.';
    case 429:
      return 'Слишком много запросов. Попробуйте позже.';
    default:
      return 'Что-то пошло не так. Попробуйте ещё раз.';
  }
}
