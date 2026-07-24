import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';

/**
 * @Global — Redis нужен многим (сессии блока 2, presence этапа 3). Раздаём без импорта
 * в каждый модуль. Второй клиент под pub/sub (этап 3) добавится сюда отдельным провайдером.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
