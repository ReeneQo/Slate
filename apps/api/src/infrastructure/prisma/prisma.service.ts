import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@slate/database';

import { ConfigService } from '../../config/config.service';

/**
 * Единственный инстанс PrismaClient на приложение, управляемый Nest DI.
 *
 * Prisma 7 (генератор prisma-client) подключается только через driver adapter —
 * конструктор больше не принимает datasource url напрямую. Отсюда PrismaPg (@prisma/adapter-pg)
 * поверх pg; connectionString берём из валидированного ConfigService, НЕ из process.env.
 *
 * $connect/$disconnect повешены на жизненный цикл Nest. enableShutdownHooks (main.ts)
 * гарантирует вызов onModuleDestroy на SIGTERM/SIGINT — коннекты закрываются чисто.
 * Query-логгер намеренно не включаем (при необходимости добавим нативно позже).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.database.url }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
