import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

import { setContainers } from './helpers/container-registry';
import {
  applyMigrations,
  DATABASE_URL_ENV_VAR,
  POSTGRES_IMAGE,
  REDIS_IMAGE,
  REDIS_URL_ENV_VAR,
} from './helpers/shared-connection';

/**
 * ОДИН Postgres + ОДИН Redis на весь e2e-прогон, а не пара на файл (SLT-48). Раньше каждый из
 * шести *.e2e-spec.ts поднимал свою пару контейнеров в собственном beforeAll — с 1-2 файлами
 * это было дешевле, чем общий globalSetup, но при шести шестикратный холодный старт и память
 * перевесили. Изоляция между тестами теперь не «свежий контейнер», а truncate + flushdb
 * (resetDatabase в test/helpers/test-app.ts) — общая функция для всех спеков.
 *
 * Контейнеры стартуют параллельно: друг от друга не зависят, а на холодном старте это разница
 * между «двумя ожиданиями подряд» и «одним».
 */
export default async function globalSetup(): Promise<void> {
  const [postgres, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);

  // Миграции — до публикации URL: первый же тест, стартовавший чуть раньше, не должен успеть
  // увидеть пустую базу без таблиц.
  applyMigrations(postgres.getConnectionUri());

  process.env[DATABASE_URL_ENV_VAR] = postgres.getConnectionUri();
  process.env[REDIS_URL_ENV_VAR] = redis.getConnectionUrl();

  setContainers({ postgres, redis });
}
