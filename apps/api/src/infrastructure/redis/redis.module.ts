import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';
import { RedisPubSubProvider } from './redis-pubsub.provider';

/**
 * @Global — Redis нужен многим (сессии блока 2, throttler SLT-29, pub/sub этапа 3). Раздаём
 * без импорта в каждый модуль.
 *
 * RedisPubSubProvider — отдельный провайдер с парой соединений под Redis-адаптер socket.io
 * (SLT-34): основной command-клиент для pub/sub непригоден (см. сам провайдер). Экспортируется,
 * потому что его достаёт из DI configureApp и передаёт готовые соединения ws-адаптеру.
 */
@Global()
@Module({
  providers: [RedisService, RedisPubSubProvider],
  exports: [RedisService, RedisPubSubProvider],
})
export class RedisModule {}
