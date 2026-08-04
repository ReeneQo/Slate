import { InternalServerErrorException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ConfigService } from '../../../config/config.service';
import { SessionsService } from './sessions.service';

const SESSION_NAME = 'slate.sid';
const USER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';

/** Колбэк express-session: первый аргумент — ошибка либо её отсутствие. */
type SessionCallback = (error?: Error | null) => void;

function createConfig(): ConfigService {
  return new ConfigService({
    app: { port: 3000, nodeEnv: 'test', allowedOrigin: 'http://localhost:5173', trustProxy: 0 },
    database: { url: 'postgresql://localhost:5434/slate_test' },
    redis: { url: 'redis://localhost:6381' },
    session: {
      secret: 'x'.repeat(32),
      name: SESSION_NAME,
      maxAgeMs: 604_800_000,
      domain: undefined,
      secureCookie: false,
    },
  });
}

/**
 * Заглушка `req.session`. Методы express-session колбэчные, поэтому моки вызывают
 * колбэк — с ошибкой или без.
 *
 * `trace` фиксирует ПОРЯДОК шагов и состояние userId в момент каждого из них. Именно
 * порядок здесь и является предметом проверки: перепутанный regenerate/присваивание —
 * это либо потерянная сессия, либо дыра session fixation, и оба варианта наружу выглядят
 * как успешный логин.
 */
function createRequest(options: { regenerateError?: Error; saveError?: Error } = {}) {
  const trace: string[] = [];

  const session = {
    userId: undefined as string | undefined,

    regenerate(callback: SessionCallback) {
      trace.push(`regenerate:userId=${String(session.userId)}`);
      // Настоящий regenerate заводит чистый объект сессии — воспроизводим это,
      // иначе тест не поймал бы присваивание, сделанное ДО регенерации.
      session.userId = undefined;
      callback(options.regenerateError ?? null);
      return session;
    },

    save(callback: SessionCallback) {
      trace.push(`save:userId=${String(session.userId)}`);
      callback(options.saveError ?? null);
      return session;
    },

    destroy(callback: SessionCallback) {
      trace.push('destroy');
      callback(null);
      return session;
    },
  };

  return { req: { session } as unknown as Request, session, trace };
}

function createResponse() {
  return { clearCookie: jest.fn() } as unknown as Response & { clearCookie: jest.Mock };
}

describe('SessionsService', () => {
  const sessionsService = new SessionsService(createConfig());

  describe('saveSession', () => {
    it('регенерирует сессию, затем пишет userId и сохраняет', async () => {
      const { req, session, trace } = createRequest();

      await sessionsService.saveSession(req, { id: USER_ID });

      // Главное утверждение таски: на момент regenerate userId ещё не задан, а к моменту
      // save — уже задан. Проверяем именно последовательность, а не факт вызовов:
      // «оба метода вызваны» прошло бы и при неверном порядке.
      expect(trace).toEqual(['regenerate:userId=undefined', `save:userId=${USER_ID}`]);
      expect(session.userId).toBe(USER_ID);
    });

    it('не теряет userId из-за очистки сессии в regenerate', async () => {
      const { req, session } = createRequest();

      await sessionsService.saveSession(req, { id: USER_ID });

      // Регрессия на порядок: если присвоить userId до regenerate, он будет стёрт,
      // и здесь окажется undefined при формально успешном логине.
      expect(session.userId).toBe(USER_ID);
    });

    it('падает при ошибке regenerate и не выставляет userId', async () => {
      const { req, session, trace } = createRequest({ regenerateError: new Error('redis down') });

      await expect(sessionsService.saveSession(req, { id: USER_ID })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );

      expect(session.userId).toBeUndefined();
      // save вызываться не должен: сорванная регенерация означает, что старый
      // session-id остался жив, и записывать в него пользователя нельзя.
      expect(trace).toEqual(['regenerate:userId=undefined']);
    });

    it('падает при ошибке save', async () => {
      const { req } = createRequest({ saveError: new Error('redis down') });

      await expect(sessionsService.saveSession(req, { id: USER_ID })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('destroySession', () => {
    it('удаляет сессию и снимает куку теми же атрибутами', async () => {
      const { req, trace } = createRequest();
      const res = createResponse();

      await sessionsService.destroySession(req, res);

      expect(trace).toEqual(['destroy']);
      expect(res.clearCookie).toHaveBeenCalledTimes(1);

      const [cookieName, cookieOptions] = res.clearCookie.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];

      expect(cookieName).toBe(SESSION_NAME);
      // Браузер удалит куку, только если совпадут name, path и domain — поэтому
      // clearCookie обязан получить те же атрибуты, с которыми кука ставилась.
      expect(cookieOptions).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
      });
    });
  });
});
