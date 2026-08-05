import type { Session, SessionData } from 'express-session';
import type { ExtendedError } from 'socket.io';

import { AppSocket } from './realtime.types';
import { createWsAuthMiddleware } from './ws-auth.middleware';

/**
 * Юнит ws-auth-middleware изолирует ровно одно правило: «есть userId в сессии → пускаем, нет →
 * отклоняем». Настоящий handshake, куки, Redis и express-session здесь НЕ участвуют — их работа
 * (разобрать куку, поднять сессию из стора) проверяется на своём слое, а сюда сессия приходит уже
 * разобранной. Поэтому socket подделываем до минимума из двух полей, которых касается middleware:
 * `request.session` (вход) и `data` (куда пишется userId).
 *
 * e2e с реальным подключением отложены осознанно (SLT-32): без содержательных событий (presence/
 * sync) им нечего проверять сверх этого юнита, а поднимать socket.io-client с настоящей кукой ради
 * одной ветки auth — несоразмерно. Появятся события — появится и e2e-ws.
 */

/** Минимальный socket под то, что читает и пишет middleware. Остальное AppSocket здесь не нужно. */
function fakeSocket(session: (Session & Partial<SessionData>) | undefined): AppSocket {
  return {
    request: { session },
    data: {},
  } as unknown as AppSocket;
}

/** Сессия с заданным userId (и опционально снимком поколения). Остальные поля роли тут не играют. */
function sessionWith(
  userId: string | undefined,
  sessionGen?: number,
): Session & Partial<SessionData> {
  return { userId, sessionGen } as Session & Partial<SessionData>;
}

describe('createWsAuthMiddleware', () => {
  it('пропускает соединение и кладёт userId в socket.data, когда сессия содержит userId', () => {
    // Arrange
    const socket = fakeSocket(sessionWith('user-1'));
    const next = jest.fn<void, [ExtendedError?]>();

    // Act
    createWsAuthMiddleware()(socket, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    // Ровно один вызов и без аргумента-ошибки — это и есть «соединение разрешено».
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe('user-1');
  });

  it('кладёт снимок поколения сессии в socket.data.sessionGen рядом с userId', () => {
    // Arrange
    const socket = fakeSocket(sessionWith('user-1', 3));
    const next = jest.fn<void, [ExtendedError?]>();

    // Act
    createWsAuthMiddleware()(socket, next);

    // Assert
    expect(socket.data.sessionGen).toBe(3);
  });

  it('трактует отсутствие снимка поколения в сессии как поколение 0 (до-SLT-31 сессии)', () => {
    // Arrange: sessionGen не задан вовсе — та же трактовка, что у AuthGuard и SessionsService.
    const socket = fakeSocket(sessionWith('user-1'));
    const next = jest.fn<void, [ExtendedError?]>();

    // Act
    createWsAuthMiddleware()(socket, next);

    // Assert
    expect(socket.data.sessionGen).toBe(0);
  });

  it('отклоняет соединение, когда сессия есть, но userId в ней нет', () => {
    // Arrange
    const socket = fakeSocket(sessionWith(undefined));
    const next = jest.fn<void, [ExtendedError?]>();

    // Act
    createWsAuthMiddleware()(socket, next);

    // Assert: next вызван С ошибкой — на handshake это отклоняет соединение целиком.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    // userId на сокет не попал: анонимный сокет не должен нести опознанного пользователя.
    expect(socket.data.userId).toBeUndefined();
  });

  it('отклоняет соединение, когда сессии нет вовсе (кука не долетела или протухла)', () => {
    // Arrange
    const socket = fakeSocket(undefined);
    const next = jest.fn<void, [ExtendedError?]>();

    // Act
    createWsAuthMiddleware()(socket, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.data.userId).toBeUndefined();
  });
});
