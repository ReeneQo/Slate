import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Единый flat-config на весь монорепо (ESLint 9).
 *
 * Слои (порядок важен — последующие переопределяют предыдущие):
 *  1. Базовые рекомендации JS + TS (без типов) на весь репо.
 *  2. Общие плагины качества импортов (sort / unused / cycle).
 *  3. Type-aware правила — только на исходники (папки src внутри apps и packages),
 *     где доступна информация о типах. Конфиги в проект не входят.
 *  4. Фронт: React + хуки + a11y + границы слоёв FSD.
 *  5. CommonJS-конфиги.
 *  6. prettier (eslint-config-prettier) — гасит форматные правила, идёт последним.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      // Сгенерированный Prisma-клиент (@slate/database) — не наш код, не линтуем.
      '**/generated/**',
    ],
  },

  // 1. База.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 2. Общие правила импортов и неиспользуемого кода (на весь репо).
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: {
      import: importPlugin,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',

      // unused-imports заменяет no-unused-vars: умеет авто-удалять импорты.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Детерминированный порядок импортов/экспортов (--fix).
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // Структурные проверки графа импортов.
      'import/no-cycle': 'error',
      'import/no-self-import': 'error',
      'import/no-useless-path-segments': 'error',
      'import/no-duplicates': 'error',
    },
  },

  // 3. Type-aware правила — только исходники (где есть типы).
  {
    files: ['apps/api/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // recommendedTypeChecked заново включает базовое правило — глушим,
      // неиспользуемое отдаём unused-imports (блок 2), чтобы не дублировать.
      '@typescript-eslint/no-unused-vars': 'off',

      // Ловит незаваренные промисы и гонки — критично для async-кода Nest.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // 4. Фронт: React + хуки + a11y + границы слоёв FSD.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
      boundaries,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: {
      react: { version: 'detect' },
      // Слои FSD: тип элемента определяется по пути.
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/web/src/app/**' },
        { type: 'widgets', pattern: 'apps/web/src/widgets/**' },
        { type: 'features', pattern: 'apps/web/src/features/**' },
        { type: 'entities', pattern: 'apps/web/src/entities/**' },
        { type: 'shared', pattern: 'apps/web/src/shared/**' },
      ],
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // FSD: импорт разрешён только «вниз» по слоям (app → … → shared).
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: { type: 'app' },
              allow: { to: { type: ['widgets', 'features', 'entities', 'shared'] } },
            },
            {
              from: { type: 'widgets' },
              allow: { to: { type: ['features', 'entities', 'shared'] } },
            },
            { from: { type: 'features' }, allow: { to: { type: ['entities', 'shared'] } } },
            { from: { type: 'entities' }, allow: { to: { type: ['shared'] } } },
            { from: { type: 'shared' }, allow: { to: { type: ['shared'] } } },
          ],
        },
      ],
    },
  },

  // 5. CommonJS-конфиги (prettier.config.js, commitlint.config.js).
  {
    files: ['**/*.config.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // 6. Prettier выключает форматные правила — должен идти последним.
  prettier,
);
