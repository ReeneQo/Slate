import type { IncomingMessage } from 'node:http';

import type { Session, SessionData } from 'express-session';
import type { ExtendedError } from 'socket.io';

import type { AppSocket } from './realtime.types';

/**
 * Handshake-запрос с уже разобранной сессией.
 *
 * `socket.request` в socket.io типизирован как голый `IncomingMessage` — на нём нет `session`.
 * Расширяем локально пересечением, а НЕ глобальным дополнением `http.IncomingMessage`: глобально
 * это сделало бы `.session` доступным на КАЖДОМ входящем запросе процесса, включая те, что не
 * проходили через session-middleware, и превратило бы тип в тихую ложь. Здесь же поле помечено
 * опциональным честно: к auth-middleware сокет доходит уже пропущенным через session-парсер
 * (см. порядок `io.use` в адаптере), но на уровне типа гарантии нет, и `undefined` разбирается
 * явной веткой ниже.
 */
type HandshakeRequest = IncomingMessage & {
  session?: Session & Partial<SessionData>;
};

/**
 * Connection-level аутентификация сокета.
 *
 * Симметрична HTTP: как защищённый роут без сессии получает 401, так и сокет без сессии не
 * устанавливает соединение вообще — `next(error)` на этой стадии отклоняет handshake, и клиент
 * получает `connect_error`, а не подключённый, но бесправный сокет. Это осознанный выбор места
 * проверки (SLT-32): аноним отсекается на входе, а не на каждом последующем событии.
 *
 * Что здесь НЕ проверяется и почему:
 *   - Поколение сессии (SLT-31). Разрыв уже установленных сокетов по инвалидации — отдельная
 *     забота ws-lifecycle этапа 3; здесь только фундамент, снимок поколения не сверяется.
 *   - Права на доску (`canAccess`). Авторизация конкретных действий/комнат — это ws-guard на
 *     событии `join` (3.3), а не connection-level middleware. Тут решается ровно один вопрос:
 *     «есть ли вообще опознанный пользователь за этим сокетом».
 *
 * Фабрика, а не готовая функция: так у middleware нет модульного состояния, тест получает
 * свежий экземпляр, а сигнатура остаётся местом для будущих зависимостей (если 3.x понадобится
 * что-то инъектировать — контракт менять не придётся).
 */
export function createWsAuthMiddleware() {
  return (socket: AppSocket, next: (err?: ExtendedError) => void): void => {
    const { session } = socket.request as HandshakeRequest;
    const userId = session?.userId;

    if (userId === undefined) {
      // Сообщение намеренно скупое: клиенту незачем знать, сессии нет, она протухла или кука
      // не долетела — наружу это всё «не авторизован», как и 401 на HTTP.
      next(new Error('Требуется авторизация'));
      return;
    }

    // Опознанный пользователь фиксируется на сокете на всё соединение: дальше обработчики
    // событий берут userId отсюда, а не перечитывают сессию на каждый чих.
    socket.data.userId = userId;
    next();
  };
}
