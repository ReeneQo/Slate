import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigService } from './config.service';
import type { AppConfig } from './env.schema';

/**
 * Динамический модуль: валидированный конфиг приходит извне (из main.ts, где он
 * проверяется ДО старта Nest) и раздаётся через DI как готовый ConfigService.
 *
 * global: true — конфиг нужен многим модулям (Prisma, Redis, будущие домены),
 * импортировать его в каждый было бы шумом.
 */
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: ConfigService, useValue: new ConfigService(config) }],
      exports: [ConfigService],
    };
  }
}
