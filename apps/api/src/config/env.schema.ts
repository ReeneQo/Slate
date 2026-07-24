import { z } from 'zod';

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

  // Задел под блок 2 (сессии): пока не обязателен. Наполнится позже.
  SESSION_SECRET: z.string().min(1).optional(),
});

export const envSchema = rawEnvSchema.transform((env) => ({
  app: {
    port: env.API_PORT,
    nodeEnv: env.NODE_ENV,
    allowedOrigin: env.ALLOWED_ORIGIN,
    sessionSecret: env.SESSION_SECRET ?? null,
  },
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
}));

/** Типизированный конфиг, сгруппированный по доменам. Выведен из zod-схемы. */
export type AppConfig = z.infer<typeof envSchema>;
