import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionGenerationService } from '../../modules/auth/sessions/session-generation.service';

/**
 * «Есть ли активная И не отозванная сессия».
 *
 * Guard отвечает на два вопроса. Первый — прежний (SLT-16): есть ли вообще сессия с userId.
 * Второй добавлен в SLT-31: не устарело ли её ПОКОЛЕНИЕ. В сессии лежит снимок поколения на
 * момент входа; здесь он сверяется с актуальным поколением пользователя в Redis. Если они
 * разошлись — сессию выпустили до logout-all, она отозвана, и её место 401.
 *
 * ЭТО ОСОЗНАННОЕ ИЗМЕНЕНИЕ СВОЙСТВА GUARD'А. В SLT-16 он гордо не ходил никуда: решение
 * пускать/не пускать принималось по одному лишь наличию userId, без единого запроса. Теперь
 * на каждый защищённый запрос добавляется +1 чтение из Redis (GET поколения). Это не регресс
 * и не нарушение инварианта — это цена отзыва сессий, и она мизерна: один GET по строковому
 * ключу против невозможности «выйти на всех устройствах» вообще. Guard по-прежнему НЕ трогает
 * Postgres и НЕ грузит пользователя — актуальные данные достаёт тот, кому они нужны (getMe).
 *
 * Расхождение поколений уничтожает сессию в хранилище (`req.session.destroy`) прямо здесь, а
 * не только отвечает 401: иначе отозванная запись жила бы в Redis до TTL и по украденной куке
 * ею можно было бы пользоваться дальше. Куку клиенту при этом НЕ гасим (в отличие от честного
 * logout) — на защищённом роуте под рукой нет тех же атрибутов, а нужды нет: сессия в сторе
 * уже мертва, и следующий запрос по этой куке всё равно упрётся в отсутствие сессии.
 *
 * Различие 401 vs 403 — прежнее: отсутствие/недействительность сессии это 401 «представься»,
 * а не 403 «нельзя». Фронт по 401 ведёт на логин, по 403 показал бы «нет доступа» тому, кому
 * достаточно перезайти. Ролей тут по-прежнему нет: роль в Slate — членство в доске
 * (BoardMember.role), она живёт в board-модуле, а не в глобальном атрибуте пользователя.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessionGeneration: SessionGenerationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const { userId } = request.session;

    // Бросаем исключение, а НЕ возвращаем false: на false Nest отвечает 403 Forbidden
    // («ты опознан, но тебе нельзя»), тогда как отсутствие сессии — это 401 Unauthorized.
    if (userId === undefined) {
      throw new UnauthorizedException('Требуется авторизация');
    }

    // Снимок и актуальное поколение читаются через одну и ту же трактовку «отсутствие = 0».
    // Для сессии из до-SLT-31 эпохи снимка нет — она приравнивается к поколению 0 и потому
    // остаётся жить, пока первый logout-all не сдвинет счётчик. Мягкая совместимость: деплой
    // механизма не выкидывает разом всех уже вошедших.
    const snapshot = request.session.sessionGen ?? 0;
    const current = await this.sessionGeneration.getCurrent(userId);

    if (snapshot !== current) {
      await this.destroy(request);
      throw new UnauthorizedException('Сессия недействительна');
    }

    return true;
  }

  /**
   * Уничтожение отозванной сессии в хранилище. Колбэчный API express-session → Promise.
   * Ошибку destroy проглатываем сознательно: даже если стереть запись не удалось, ответ всё
   * равно обязан быть 401 — сессия отозвана по факту расхождения поколений, а не по факту
   * успешного удаления. Пробросить ошибку destroy значило бы отдать 500 туда, где по смыслу
   * ровно 401.
   */
  private destroy(req: Request): Promise<void> {
    return new Promise((resolve) => {
      req.session.destroy(() => {
        resolve();
      });
    });
  }
}
