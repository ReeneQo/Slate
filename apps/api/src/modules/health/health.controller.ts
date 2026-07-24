import { Controller, Get } from '@nestjs/common';

/**
 * Liveness-проба: процесс поднялся и отвечает.
 * Проверку коннектов к БД/Redis (readiness, terminus) добавим в SLT-12.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
