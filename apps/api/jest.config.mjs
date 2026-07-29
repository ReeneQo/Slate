import { loadSwcConfig } from './jest.swc.mjs';

/**
 * Юнит-тесты apps/api: быстрые, без Docker и без сети. Всё, что требует настоящих Postgres
 * и Redis, живёт в отдельном раннере — см. jest-e2e.config.mjs.
 *
 * Разделение проходит по `roots`, а не по имени файла: сюда попадает только `src`, где
 * `*.spec.ts` лежат рядом с кодом, а `test/` с e2e физически вне области видимости. Это
 * важнее, чем кажется: e2e тянут контейнеры и стартуют десятки секунд, и попади они в общий
 * прогон — `pnpm test` перестал бы быть командой, которую запускают не задумываясь.
 *
 * Паттерн `*.spec.ts` выбран не случайно: apps/web на vitest использует `*.test.ts`, так
 * что два раннера физически не могут подобрать файлы друг друга даже при общем прогоне.
 *
 * @type {import('jest').Config}
 */
export default {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  // moduleNameMapper не нужен: в tsconfig apps/api нет paths, а @slate/database
  // резолвится обычным symlink'ом в node_modules (см. комментарий в tsconfig.json).
  transform: {
    '^.+\\.ts$': ['@swc/jest', loadSwcConfig()],
  },

  clearMocks: true,

  // Порога намеренно НЕТ. Сейчас покрыты только чистые функции; порог на этом этапе
  // либо будет заведомо низким и бессмысленным, либо начнёт падать на каждой таске.
  // Вводить, когда появятся моки репозитория и тесты сервисов.
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
};
