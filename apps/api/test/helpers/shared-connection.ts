import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Образы те же, что в docker-compose.yml. Расхождение здесь — худший вид зелёных тестов:
 * они проверяли бы поведение СУБД, которой нет ни у кого ни в деве, ни в проде. Версии
 * зафиксированы точно (не `latest`) по той же причине — прогон не должен менять смысл
 * оттого, что в реестре обновился тег.
 */
export const POSTGRES_IMAGE = 'postgres:16';
export const REDIS_IMAGE = 'redis:7';

/** Корень пакета с Prisma-схемой: миграции запускаются оттуда, схема адресуется относительно него. */
const DATABASE_PACKAGE_DIR = resolve(__dirname, '../../../../packages/database');

/**
 * Имена переменных, которыми globalSetup (test/global-setup.ts) передаёт connection-строки
 * общих контейнеров тестовым файлам. Канал — process.env, а не возврат значения: Jest форкает
 * воркеры ПОСЛЕ globalSetup и они наследуют process.env на момент форка — это единственный
 * способ передать значение из globalSetup в *.e2e-spec.ts, которые выполняются в другом
 * процессе/контексте.
 *
 * Префикс E2E_, а не голые DATABASE_URL/REDIS_URL: так значение не спутать с тем, что читает
 * validateEnv настоящего приложения — здесь это просто перевозка строки, а не конфиг.
 */
export const DATABASE_URL_ENV_VAR = 'E2E_DATABASE_URL';
export const REDIS_URL_ENV_VAR = 'E2E_REDIS_URL';

/**
 * Накатывает миграции на свежий контейнер. Вызывается ОДИН раз из globalSetup — контейнер
 * общий на весь e2e-прогон, повторный накат на каждый файл не нужен и стоил бы кратно дороже.
 *
 * `migrate deploy`, а не `migrate dev`: deploy только применяет уже существующие файлы
 * миграций и ничего не генерирует. dev в этой роли стал бы сравнивать схему с базой, а при
 * расхождении — предлагать сброс, то есть интерактивный вопрос посреди прогона.
 *
 * DATABASE_URL передаётся ТОЛЬКО дочернему процессу, через его env. Писать его в
 * process.env текущего процесса нельзя: prisma.config.ts читает переменную «мягко», и такая
 * запись протекла бы в остальной прогон (включая сам globalSetup, который следом пишет
 * E2E_DATABASE_URL с тем же значением, но под своим именем).
 */
export function applyMigrations(databaseUrl: string): void {
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: DATABASE_PACKAGE_DIR,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    // Без этого наружу выходит голое «Command failed» с кодом возврата: stdio: 'pipe'
    // проглатывает stderr Prisma, где как раз и написана настоящая причина.
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';

    throw new Error(`prisma migrate deploy не отработал:\n${stderr}`);
  }
}

export interface SharedConnectionStrings {
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

/**
 * Читает connection-строки общих контейнеров, поднятых globalSetup. Падает с понятным
 * сообщением, а не глухим undefined в буквальном URL: если это всплыло, значит e2e запущен
 * в обход jest-e2e.config.mjs (например, точечным `jest test/board.e2e-spec.ts` без --config)
 * и globalSetup не отработал.
 */
export function readSharedConnectionStrings(): SharedConnectionStrings {
  const databaseUrl = process.env[DATABASE_URL_ENV_VAR];
  const redisUrl = process.env[REDIS_URL_ENV_VAR];

  if (databaseUrl === undefined || redisUrl === undefined) {
    throw new Error(
      `${DATABASE_URL_ENV_VAR}/${REDIS_URL_ENV_VAR} не заданы — похоже, e2e запущен без ` +
        'globalSetup (см. globalSetup в jest-e2e.config.mjs и test/global-setup.ts)',
    );
  }

  return { databaseUrl, redisUrl };
}
