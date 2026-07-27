import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ConfigService } from '../../../config/config.service';
import { createSessionCookieOptions } from '../../../infrastructure/session/session.factory';
import type { SafeUser } from '../../user/entities/user.entity';

/**
 * Работа с жизненным циклом сессии: вход и выход.
 *
 * Сервис не знает про Redis и не ходит в него сам — хранилище подключено как store
 * session-middleware (см. session.factory). Здесь только правила поверх `req.session`,
 * и это осознанно: заменив store на другой, менять сервис не придётся.
 *
 * Эндпоинтов тут нет — их принесёт SLT-16, он и будет вызывать эти методы.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Привязывает сессию к пользователю после успешной аутентификации.
   *
   * Порядок шагов — не стилистика, а защита от session fixation. Атака: жертве заранее
   * подсовывают известный атакующему session-id (через ссылку, поддомен, XSS), она
   * логинится, и сервер повышает права У ТОГО ЖЕ идентификатора — атакующий оказывается
   * внутри её сессии со своей копией куки. `regenerate` выдаёт НОВЫЙ id и выбрасывает
   * старый, поэтому подсунутый заранее идентификатор после логина ничего не стоит.
   *
   * userId ставится СТРОГО после regenerate: regenerate очищает объект сессии, и запись,
   * сделанная до него, будет молча стёрта — пользователь получил бы 200 и пустую сессию.
   *
   * Принимаем `Pick<SafeUser, 'id'>`, а не всего пользователя: функция читает ровно одно
   * поле, и подпись это фиксирует.
   */
  async saveSession(req: Request, user: Pick<SafeUser, 'id'>): Promise<void> {
    await this.regenerate(req);

    req.session.userId = user.id;

    await this.persist(req);
  }

  /**
   * Завершает сессию: удаляет её из хранилища и снимает куку у клиента.
   *
   * Оба шага нужны. Без destroy запись остаётся в Redis до истечения TTL и её можно
   * переиспользовать по украденной куке; без clearCookie у клиента остаётся кука на
   * несуществующую сессию, и следующий запрос выглядит как «протухшая», а не «вышел».
   *
   * clearCookie получает ТЕ ЖЕ атрибуты, с которыми кука ставилась: браузер удалит её,
   * только если совпадут name, domain и path.
   */
  async destroySession(req: Request, res: Response): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => {
        if (error) {
          reject(new InternalServerErrorException('Не удалось завершить сессию'));
          return;
        }

        resolve();
      });
    });

    res.clearCookie(this.config.session.name, createSessionCookieOptions(this.config));
  }

  /** Новый session-id взамен текущего. Колбэчный API express-session → Promise. */
  private regenerate(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) {
          reject(new InternalServerErrorException('Не удалось пересоздать сессию'));
          return;
        }

        resolve();
      });
    });
  }

  /**
   * Явная запись в store до отправки ответа.
   *
   * Без неё express-session сохраняет сессию асинхронно в конце запроса, и клиент может
   * успеть прийти со следующим запросом раньше, чем запись доедет до Redis, — редкая
   * гонка, которая выглядит как «залогинился, но не залогинен».
   */
  private persist(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      req.session.save((error) => {
        if (error) {
          reject(new InternalServerErrorException('Не удалось сохранить сессию'));
          return;
        }

        resolve();
      });
    });
  }
}
