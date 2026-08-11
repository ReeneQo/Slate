import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';

/**
 * Мост между globalSetup и globalTeardown (SLT-48): Jest выполняет оба хука в ОДНОМ процессе,
 * не форкая между ними воркер, — обычный module-level синглтон переживает от старта до останова.
 * Это не предположение: поведение проверено отдельным пробным прогоном на используемой версии
 * Jest (30.4.2) перед тем, как полагаться на него здесь, — require одного и того же пути внутри
 * одного процесса возвращает один и тот же закешированный модуль что в setup, что в teardown.
 *
 * process.env для этого не годится: там можно передать только строки (сериализованные URL),
 * а погасить контейнер нужен сам объект StartedTestContainer с его stop().
 */
interface ContainerHandles {
  readonly postgres: StartedPostgreSqlContainer;
  readonly redis: StartedRedisContainer;
}

let handles: ContainerHandles | undefined;

export function setContainers(next: ContainerHandles): void {
  handles = next;
}

export function getContainers(): ContainerHandles {
  if (handles === undefined) {
    throw new Error('globalTeardown вызван без globalSetup — контейнеры не зарегистрированы');
  }

  return handles;
}
