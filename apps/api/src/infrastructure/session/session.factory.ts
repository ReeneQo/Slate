import { RedisStore } from 'connect-redis';
// CookieOptions берём из express, а НЕ из express-session: у них разные типы с одним
// именем (express-session допускает `expires: null`). Нужен именно express-овский —
// его требует res.clearCookie, и он же без потерь принимается express-session.
import type { CookieOptions, RequestHandler } from 'express';
import session from 'express-session';
import type { Redis } from 'ioredis';

import type { ConfigService } from '../../config/config.service';

/**
 * Префикс ключей сессий в Redis. Захардкожен намеренно — это внутренняя раскладка
 * пространства ключей, а не настройка окружения: менять её на лету незачем, а лишний
 * env-ключ пришлось бы держать синхронным между инстансами, иначе половина парка
 * перестанет видеть чужие сессии.
 */
const SESSION_KEY_PREFIX = 'slate:sess:';

const MS_IN_SECOND = 1000;

/**
 * Атрибуты cookie сессии.
 *
 * Вынесены отдельно и переиспользуются в двух местах: при создании middleware и при
 * `res.clearCookie` на логауте. Это не украшательство — Express удаляет куку, сопоставляя
 * её по имени, domain и path. Разойдись эти атрибуты между установкой и очисткой,
 * логаут перестал бы удалять куку в проде (где задан domain), не сообщая об этом никак.
 */
export function createSessionCookieOptions(config: ConfigService): CookieOptions {
  const { maxAgeMs, domain, secureCookie } = config.session;

  return {
    // Хардкод: JS-доступ к сессионной куке не нужен никогда, а его наличие превращает
    // любой XSS в кражу сессии.
    httpOnly: true,
    // Хардкод: lax отсекает CSRF на межсайтовых POST, но сохраняет вход по обычной
    // ссылке извне. strict ломал бы навигацию с внешних ссылок, none требует secure.
    sameSite: 'lax',
    // Выведено из NODE_ENV в конфиге, не из отдельной env-переменной.
    secure: secureCookie,
    domain,
    path: '/',
    maxAge: maxAgeMs,
  };
}

/**
 * Session-middleware поверх ОБЩЕГО ioredis-клиента (SLT-12).
 *
 * Отдельное соединение под сессии не заводим: это обычные команды get/set, они
 * мультиплексируются в один коннект. Выделенный клиент понадобится только под pub/sub
 * этапа 3, где режим подписки блокирует обычные команды (см. redis.factory).
 *
 * Фабрика, а не конструирование по месту в main.ts: bootstrap остаётся списком шагов,
 * а детали конфигурации лежат рядом с остальной инфраструктурой — как redis.factory.
 * Вызывается всё равно из main.ts, то есть инициализация остаётся на bootstrap-уровне.
 */
export function createSessionMiddleware(config: ConfigService, client: Redis): RequestHandler {
  const { secret, name, maxAgeMs } = config.session;

  return session({
    secret,
    name,
    // Не переписывать сессию в Redis, если она не менялась: лишняя запись на каждый
    // запрос — это и нагрузка, и гонка между параллельными запросами одного клиента.
    resave: false,
    // Не создавать запись для анонимов. Иначе каждый заход бота плодит ключ в Redis,
    // а куки раздаются тем, кто ничего не делал.
    saveUninitialized: false,
    cookie: createSessionCookieOptions(config),
    store: new RedisStore({
      client,
      prefix: SESSION_KEY_PREFIX,
      // ttl у store — в СЕКУНДАХ, maxAge у куки — в миллисекундах. Единственная точка
      // конверсии; floor, чтобы TTL не оказался дробным.
      ttl: Math.floor(maxAgeMs / MS_IN_SECOND),
    }),
  });
}
