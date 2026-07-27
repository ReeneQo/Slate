import { Injectable } from '@nestjs/common';

import type { AppConfig } from './env.schema';

/**
 * Обёртка над валидированным конфигом для инъекции через DI.
 *
 * Своя реализация, а НЕ @nestjs/config: тот отдаёт значения как `string | undefined`
 * (слабая типизация, generic-геттеры), из-за чего терялся бы вывод типов из zod —
 * а типобезопасность здесь главная ценность. Здесь геттеры возвращают точные доменные
 * типы, выведенные из схемы.
 */
@Injectable()
export class ConfigService {
  constructor(private readonly config: AppConfig) {}

  get app(): AppConfig['app'] {
    return this.config.app;
  }

  get database(): AppConfig['database'] {
    return this.config.database;
  }

  get redis(): AppConfig['redis'] {
    return this.config.redis;
  }

  get session(): AppConfig['session'] {
    return this.config.session;
  }
}
