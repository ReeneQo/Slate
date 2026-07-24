import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Подгружает переменные из корневого .env монорепо в process.env — БЕЗ внешних зависимостей
 * (встроенный Node ≥20.12). Убрали @nestjs/config, dotenv не ставим.
 *
 * process.loadEnvFile НЕ перетирает уже заданные переменные: в проде/CI значения приходят
 * из реального окружения и побеждают, файл лишь добирает недостающее в деве. Если .env нет
 * (прод) — тихо пропускаем: валидация в validateEnv поймает отсутствие обязательных переменных.
 *
 * .env один на монорепо (см. turbo globalDependencies). Приложение запускается с cwd = apps/api,
 * поэтому корень — на два уровня выше; на всякий случай пробуем и локальный apps/api/.env.
 */
export function loadEnv(): void {
  const candidates = [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')];
  const envFile = candidates.find((path) => existsSync(path));

  if (envFile) {
    process.loadEnvFile(envFile);
  }
}
