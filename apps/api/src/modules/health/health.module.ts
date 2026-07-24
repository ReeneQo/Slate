import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Отдельный модуль под health — избегаем корневого AppController (дефолтной Nest-каши).
 * PrismaService/RedisService инжектятся из глобальных PrismaModule/RedisModule.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
