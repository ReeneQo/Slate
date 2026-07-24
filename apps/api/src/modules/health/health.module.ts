import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/** Отдельный модуль под health — избегаем корневого AppController (дефолтной Nest-каши). */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
