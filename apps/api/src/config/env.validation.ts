import { type AppConfig, envSchema } from './env.schema';

/**
 * Валидирует process.env и возвращает типизированный конфиг ИЛИ гасит процесс.
 *
 * Вызывается в main.ts ДО NestFactory.create() — это осознанно. Если валидировать
 * внутри Nest DI, ошибка вылетает уже ПОСЛЕ старта фреймворка, и в консоли Nest-стектрейс
 * ложится поверх сообщения о битом env. До create() — чистый, читаемый вывод.
 *
 * При невалидном env печатаем список «переменная: что не так» (а не сырой объект ошибки)
 * и выходим с ненулевым кодом: сервер с битым конфигом стартовать не должен.
 */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Намеренно console, а не Nest Logger: валидация идёт до создания приложения.
    console.error(`\n❌ Invalid environment variables:\n${details}\n`);
    process.exit(1);
  }

  return result.data;
}
