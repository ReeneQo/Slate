import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { ConfigService } from '../../config/config.service';
import { createRedisClient } from './redis.factory';

/**
 * Обёртка над основным (command) ioredis-клиентом. Без бизнес-логики — только рабочий
 * коннект и доступ к клиенту; операции с Redis (сессии — блок 2, presence — этап 3)
 * будут в доменных сервисах, которые берут клиент отсюда.
 *
 * Клиент один. Второй клиент для pub/sub (этап 3) добавится отдельным провайдером через
 * ту же фабрику (createRedisClient) — этот сервис при этом не меняется.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = createRedisClient(config.redis.url);

    // Без 'error'-листенера ioredis сыпет сырые стектрейсы в stderr при каждом разрыве
    // ("Unhandled error event") и в пределе может всплыть как unhandledRejection.
    // Переподключение ioredis берёт на себя сам — нам достаточно залогировать.
    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  /** Доступ к клиенту для доменных сервисов и health-проверки. */
  get client(): Redis {
    return this.redis;
  }
}
