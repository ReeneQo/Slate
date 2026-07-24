import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { withTimeout } from '../../shared/utils/with-timeout';

/** Статус одной зависимости: поднята или недоступна (с причиной). */
type DependencyStatus = { status: 'up' } | { status: 'down'; error: string };

export interface ReadinessReport {
  status: 'ok' | 'error';
  database: DependencyStatus;
  redis: DependencyStatus;
}

const CHECK_TIMEOUT_MS = 2000;

/**
 * Readiness-проверки инфраструктуры. Каждую зависимость проверяем изолированно и
 * параллельно, чтобы в ответе было видно, ЧТО именно недоступно (а не просто «не готов»).
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async checkReadiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const status = database.status === 'up' && redis.status === 'up' ? 'ok' : 'error';

    return { status, database, redis };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      // SELECT 1 — коннект жив, таблицы не нужны (схема появится в блоке 1).
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS, 'Postgres');
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: toMessage(error) };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      await withTimeout(this.redis.client.ping(), CHECK_TIMEOUT_MS, 'Redis');
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: toMessage(error) };
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
