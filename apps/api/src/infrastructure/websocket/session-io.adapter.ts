import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import type { ExtendedError, ServerOptions } from 'socket.io';

import type { AppServer, AppSocket } from '../../modules/realtime/realtime.types';

/** socket.io-middleware — то, что принимает `io.use`. Один тип на оба слоя обвязки сокета. */
type SocketMiddleware = (socket: AppSocket, next: (err?: ExtendedError) => void) => void;

export interface SessionIoAdapterOptions {
  /**
   * ТОТ ЖЕ инстанс session-middleware, что применён к Express в configureApp. Именно инстанс, а
   * не пересозданный по тому же конфигу: иначе секрет/store/prefix пришлось бы держать
   * синхронными в двух местах, и первое же расхождение молча сломало бы чтение куки на сокете.
   */
  sessionMiddleware: RequestHandler;
  /** Connection-level проверка сессии. Живёт в modules/realtime, сюда приходит параметром. */
  authMiddleware: SocketMiddleware;
  /** Origin для ws-CORS. Тот же, что у HTTP-CORS (из ConfigService) — один источник origin. */
  allowedOrigin: string;
  /**
   * Готовые pub/sub-соединения для Redis-адаптера socket.io (SLT-34, multi-instance broadcast).
   * Структурный тип, а не сам провайдер: адаптер живёт вне DI-графа и не должен знать про
   * infrastructure/redis — ему нужны ровно два коннекта. Создаёт и закрывает их RedisPubSubProvider,
   * configureApp достаёт его из DI и прокидывает сюда.
   */
  redisPubSub: { pub: Redis; sub: Redis };
}

/**
 * Адаптирует express-session (RequestHandler) под middleware socket.io.
 *
 * На handshake express-session только ЧИТАЕТ сессию — разбирает куку и грузит запись из Redis;
 * ничего не пишет (resave/saveUninitialized выключены в фабрике). Поэтому полноценный response
 * ему не нужен: передаём пустой объект, а `next` перекладываем как есть. Приведения типов здесь —
 * это шов между двумя фреймворками: `socket.request` — это `http.IncomingMessage` (express.Request
 * его лишь расширяет), а express-session в рантайме трогает только `req.headers.cookie` и
 * присваивает `req.session`, до остальных полей Request/Response дело не доходит.
 */
function adaptSessionMiddleware(sessionMiddleware: RequestHandler): SocketMiddleware {
  return (socket, next) => {
    sessionMiddleware(socket.request as Request, {} as Response, next as NextFunction);
  };
}

/**
 * Кастомный IoAdapter: тот же адаптер Nest для socket.io, но с преднастроенным io-сервером.
 *
 * Делает ровно две вещи поверх стандартного:
 *   1. Включает ws-CORS с `credentials` — без него браузер не приложит session-куку к handshake,
 *      и аутентификация была бы невозможна в принципе. Origin берётся из конфига, тот же, что у
 *      HTTP-CORS.
 *   2. Вешает на io-сервер две middleware по порядку: сперва разбор сессии (переиспользованный
 *      express-session), затем connection-level auth. Порядок — часть контракта: auth читает уже
 *      разобранную сессию, поменяй их местами — userId всегда был бы undefined и любой сокет
 *      отклонялся бы.
 *   3. Ставит Redis-адаптер socket.io (SLT-34): `server.adapter(createAdapter(pub, sub))`. Без него
 *      broadcast в комнату доходит только до сокетов ЭТОГО инстанса — клиенты одной доски на разных
 *      инстансах не видели бы событий друг друга. Адаптер прозрачен для gateway и модели событий:
 *      меняется только транспорт broadcast под капотом (Redis pub/sub связывает инстансы). На одном
 *      инстансе он неотличим от своего отсутствия — ценность проявляется при нескольких инстансах
 *      за балансировщиком (тогда же нужны sticky-sessions на уровне инфраструктуры деплоя).
 */
export class SessionIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly options: SessionIoAdapterOptions,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): AppServer {
    // super возвращает io-сервер, привязанный к тому же HTTP-серверу, что и Express (адаптер
    // сконструирован с app). Тип родителя — `any`, поэтому сужаем к типизированному AppServer один
    // раз здесь, чтобы дальше `.use` и события были под контролем контракта.
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.options.allowedOrigin,
        credentials: true,
      },
    }) as AppServer;

    // Redis-адаптер ДО подписки middleware/событий: он лишь подменяет транспорт broadcast, но
    // ставить его логично сразу после создания сервера, пока сервер «пустой». createAdapter
    // получает готовые pub/sub из провайдера — сам адаптер соединениями не владеет.
    const { pub, sub } = this.options.redisPubSub;
    server.adapter(createAdapter(pub, sub));

    server.use(adaptSessionMiddleware(this.options.sessionMiddleware));
    server.use(this.options.authMiddleware);

    return server;
  }
}
