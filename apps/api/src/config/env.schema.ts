import { z } from 'zod';

import { durationToMs } from './duration.schema';

/**
 * Схема переменных окружения.
 *
 * Вход — «сырой» process.env (всё строки/undefined), поэтому числа приводим через
 * z.coerce. Выход СГРУППИРОВАН ПО ДОМЕНАМ (app/database/redis) через .transform:
 * так тип конфига читаемый и не разрастётся в плоскую кашу к этапу 3.
 *
 * Тип конфига ВЫВОДИТСЯ отсюда (`z.infer`), руками отдельно не пишется — единственный
 * источник правды и для валидации, и для типов.
 */
const rawEnvSchema = z.object({
  // Строки подключения — валидные URL (postgresql:// и redis:// парсятся WHATWG-парсером).
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  // Из env приходит строкой — coerce к number. Дефолт под локальный дев.
  API_PORT: z.coerce.number().int().positive().default(3000),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  ALLOWED_ORIGIN: z.string().min(1),

  // Число доверенных reverse-proxy перед бэком (Express `trust proxy`). За балансировщиком,
  // терминирующим TLS, без этого Express видит соединение как HTTP: req.secure=false (secure-кука
  // не ставится) и req.ip = IP прокси (rate-limit сваливает всех клиентов в один bucket).
  // Число хопов, а НЕ true: true доверяет любому X-Forwarded-For, включая подставленный клиентом.
  // 0 = не доверять (дев, прямое соединение), дефолт 1 = один прокси (типовой прод).
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(1),

  // Ключ подписи session-id. Обязателен: сервер без него поднимать нельзя — подделка
  // куки становится тривиальной. Минимум 32 символа ≈ 256 бит энтропии от
  // `openssl rand -base64 32`; короткий секрет перебирается офлайн по перехваченной куке.
  SESSION_SECRET: z.string().min(32, 'ожидается минимум 32 символа (openssl rand -base64 32)'),

  // Имя cookie. Своё, а не дефолтное `connect.sid`: дефолт бесплатно сообщает
  // сканеру стек (express-session).
  SESSION_NAME: z.string().min(1),

  // TTL сессии человекочитаемой строкой ("7d", "24h") → durationToMs парсит в
  // МИЛЛИСЕКУНДЫ. Единица на выходе выбрана под потребителя: express-session
  // принимает cookie.maxAge именно в мс, поэтому на месте использования нет ни
  // конверсии, ни повода перепутать секунды с миллисекундами. Для Redis-store
  // (ttl в секундах) конверсия одна, явная и в одном месте — см. session.factory.
  SESSION_MAX_AGE: durationToMs,

  // Домен cookie. ОПЦИОНАЛЬНА: в деве пусто (браузер сам привяжет к localhost —
  // явный `domain: 'localhost'` часть браузеров отвергает), в проде — общий домен
  // под кросс-сабдоменные куки (api.slate.app + app.slate.app).
  SESSION_DOMAIN: z.string().min(1).optional(),
});

export const envSchema = rawEnvSchema.transform((env) => ({
  app: {
    port: env.API_PORT,
    nodeEnv: env.NODE_ENV,
    allowedOrigin: env.ALLOWED_ORIGIN,
    trustProxy: env.TRUST_PROXY,
  },
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
  session: {
    secret: env.SESSION_SECRET,
    name: env.SESSION_NAME,
    maxAgeMs: env.SESSION_MAX_AGE,
    // undefined, а не null: express-session отличает «домен не задан» от значения,
    // и undefined — ровно то, что он ожидает при отсутствии.
    domain: env.SESSION_DOMAIN,
    // secure ВЫВОДИТСЯ из среды, а не читается из env. Это следствие, а не выбор:
    // env-флаг создаёт две одинаково тихие аварии — забыли в проде (кука уходит по
    // HTTP и снимается любым перехватчиком) или включили в деве (браузер молча
    // отбрасывает secure-куку на http://localhost, и «логин не работает» без ошибок).
    secureCookie: env.NODE_ENV === 'production',
  },
}));

/** Типизированный конфиг, сгруппированный по доменам. Выведен из zod-схемы. */
export type AppConfig = z.infer<typeof envSchema>;
