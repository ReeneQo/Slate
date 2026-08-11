import { getContainers } from './helpers/container-registry';

/**
 * Гасит общие контейнеры e2e-прогона (SLT-48). Порядок с приложениями внутри тестов уже
 * соблюдён на их стороне (app.close() перед stop() контейнеров, см. test-app.ts) — здесь
 * приложений нет вовсе, все Nest-инстансы к этому моменту закрыты собственными afterAll.
 */
export default async function globalTeardown(): Promise<void> {
  const { postgres, redis } = getContainers();

  await Promise.all([postgres.stop(), redis.stop()]);
}
