import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthService, type ReadinessReport } from './health.service';

/**
 * Две разные пробы — намеренно:
 *
 * - liveness (GET /api/health): процесс поднялся и отвечает. НИЧЕГО не проверяет.
 *   Если ляжет Postgres/Redis, процесс всё ещё жив — перезапускать его бессмысленно,
 *   поэтому liveness обязан оставаться «зелёным».
 * - readiness (GET /api/health/ready): готов ли принимать трафик — проверяет коннекты
 *   к БД и Redis. 503 при недоступной зависимости принципиален: только по коду оркестратор
 *   отличит «готов» от «не готов» и уведёт трафик, не убивая процесс.
 *
 * `@SkipThrottle()` без аргументов исключает ОБА пробы из ОБОИХ глобальных лимитов (default
 * и autosave). Балансировщик/оркестратор дёргает эти роуты пробами каждые несколько секунд —
 * под общим baseline (100/мин) он сам себя загнал бы в 429, и readiness замигал бы, уводя
 * живой трафик от здорового инстанса. Пробы намеренно вне троттлинга: они инфраструктурные,
 * а не клиентские.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.checkReadiness();

    // Тело отдаём и на 200, и на 503 — в обоих случаях видно состояние каждой зависимости.
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }

    return report;
  }
}
