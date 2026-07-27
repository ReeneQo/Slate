import { readFileSync } from 'node:fs';

/**
 * SWC-конфиг для тестов берём из ТОГО ЖЕ .swcrc, которым собирается приложение (SLT-11),
 * а не переписываем его копию сюда.
 *
 * Это не про экономию строк. @swc/jest НЕ подхватывает .swcrc сам — ему конфиг передают
 * аргументом. Продублировав значения, мы бы завели вторую, независимо стареющую копию:
 * правка .swcrc (например, смена target) молча разошлась бы с тем, как трансформируются
 * тесты, и тесты начали бы проверять код, собранный не так, как продовый.
 *
 * `$schema` выкидываем: он для редактора, а swc на незнакомый ключ ругается.
 */
function loadSwcConfig() {
  const raw = readFileSync(new URL('.swcrc', import.meta.url), 'utf8');
  const { $schema: _schema, ...swcConfig } = JSON.parse(raw);

  return swcConfig;
}

/**
 * Юнит-тесты apps/api. e2e/supertest сюда НЕ входят — появятся отдельно, когда будут
 * эндпоинты (SLT-16), и потребуют своего конфига с другим testEnvironment и setup-файлом.
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
