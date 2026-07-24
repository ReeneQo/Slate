import { Module } from '@nestjs/common';

import { HealthModule } from './modules/health/health.module';

/**
 * Корневой модуль. Инфраструктура (SLT-12) и доменные модули (блок 2)
 * подключаются сюда по мере появления. Пока — только health.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
