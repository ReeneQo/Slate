import { isApiError } from '@/shared/api';

/**
 * Маппинг типизированной ошибки share-мутаций в текст для пользователя — тот же приём, что у
 * board-list (`mapBoardError`) и auth (`mapAuthError`): текст бэка (payload) наружу НЕ показываем
 * (может утечь техническое/на 5xx лишнее), свои сообщения решает фича, знающая контекст статуса.
 */

const GENERIC = 'Что-то пошло не так. Попробуйте ещё раз.';

/**
 * Ошибка приглашения (`POST /boards/:id/members`). 404 у сервиса значит ДВЕ вещи (не-owner ИЛИ
 * email не зарегистрирован, см. `BoardMemberService.invite`) — UI показывает форму приглашения
 * только owner'у, так что практический случай ровно один: email не найден. 409 тоже значит ДВЕ
 * вещи (дубль ИЛИ self-invite) — обе сводятся к одному факту с точки зрения приглашающего: у
 * этого человека уже есть доступ, второй текст не нужен.
 */
export function mapInviteError(error: unknown): string {
  if (!isApiError(error)) return GENERIC;

  switch (error.status) {
    case 404:
      return 'Пользователь с таким email не найден';
    case 409:
      return 'У этого пользователя уже есть доступ к доске';
    case 429:
      return 'Слишком много запросов. Попробуйте позже.';
    default:
      return GENERIC;
  }
}

/** Ошибка смены роли/отзыва участника. 404 — членство уже не существует (гонка, напр. другая вкладка). */
export function mapMemberMutationError(error: unknown): string {
  if (!isApiError(error)) return GENERIC;

  switch (error.status) {
    case 404:
      return 'Участник не найден — возможно, уже удалён';
    case 429:
      return 'Слишком много запросов. Попробуйте позже.';
    default:
      return GENERIC;
  }
}

/** Ошибка загрузки списка участников. */
export function mapMemberListError(error: unknown): string {
  if (isApiError(error) && error.status === 429) {
    return 'Слишком много запросов. Попробуйте позже.';
  }
  return 'Не удалось загрузить список участников. Попробуйте ещё раз.';
}
