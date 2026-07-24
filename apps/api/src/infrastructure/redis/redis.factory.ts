import { Redis, type RedisOptions } from 'ioredis';

/**
 * Фабрика ioredis-клиента. Вынесена отдельно намеренно: на этапе 3 понадобится ВТОРОЙ
 * клиент — подписанное на канал соединение (в режиме subscribe нельзя слать обычные
 * команды, нужен отдельный коннект для pub/sub). Общая фабрика позволит завести его
 * как ещё один провайдер БЕЗ дублирования логики и БЕЗ правок текущего RedisService.
 *
 * lazyConnect: коннект не стартует в конструкторе, а поднимается явно в onModuleInit —
 * подключение привязано к жизненному циклу Nest (симметрично Prisma.$connect), а не к
 * моменту импорта модуля.
 */
export function createRedisClient(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, { lazyConnect: true, ...options });
}
