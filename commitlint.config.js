/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Доменные scope (см. CLAUDE.md). back/front/fullstack — запрещены.
    'scope-enum': [
      2,
      'always',
      [
        'board',
        'canvas',
        'auth',
        'infra',
        'db',
        'deps',
        'web',
        'api',
        'shared-types',
        'monorepo',
        'config',
        'release',
      ],
    ],
    // scope необязателен (например, `chore: ...`), но если указан — из списка выше.
    'scope-empty': [0],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'docs',
        'chore',
        'test',
        'style',
        'perf',
        'build',
        'ci',
        'revert',
      ],
    ],
  },
};
