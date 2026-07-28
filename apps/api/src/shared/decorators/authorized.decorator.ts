import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Что из «текущего пользователя» можно попросить. Сейчас — только идентификатор, и это
 * весь список: в сессии больше ничего и не лежит (см. types/express-session.d.ts).
 * Литеральный тип, а не `string`, чтобы `@Authorized('email')` не дожил до рантайма.
 */
type AuthorizedField = 'id';

/**
 * Идентификатор вошедшего пользователя — из СЕССИИ.
 *
 * Источник принципиален. В старом проекте близнец этого декоратора читал `req.user`,
 * который перед ним наполнял guard, сходив в БД. Получалась неявная связка: декоратор
 * молча возвращал undefined, если guard забыли повесить, — и роут работал «от имени
 * никого» вместо того, чтобы упасть. Здесь источник один и тот же и у guard'а, и у
 * декоратора — `req.session`, поэтому рассинхронизироваться им негде.
 *
 * Проверка на undefined — не дублирование guard'а, а страховка ровно от этого сценария:
 * декоратор без `@Authorization()` на роуте обязан дать 401, а не тихо подсунуть undefined
 * в параметр, объявленный как `string`. Иначе один незакрытый роут превращается в дыру,
 * которую не видно ни в типах, ни в тестах.
 */
export const Authorized = createParamDecorator(
  (_field: AuthorizedField, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.session?.userId;

    if (userId === undefined) {
      throw new UnauthorizedException('Требуется авторизация');
    }

    return userId;
  },
);
