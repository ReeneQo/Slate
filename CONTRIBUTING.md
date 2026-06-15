# Contributing

## Окружение

```bash
corepack enable        # включит pnpm нужной версии
pnpm install           # ставит зависимости + готовит husky-хуки
```

## Рабочий процесс

1. Ветка от `main`: `type/kebab-description` (`feat/board-crud`, `chore/setup-monorepo`).
2. Атомарные коммиты: одна часть = один коммит. Меняешь фронт и бэк — раздели на два.
3. PR → squash-merge. Заголовок merge — в формате Conventional Commits.

## Коммиты (Conventional Commits)

```
<type>(<scope>): <subject>
```

- **type:** `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `style`, `perf`, `build`, `ci`, `revert`.
- **scope (доменный):** `board`, `canvas`, `auth`, `infra`, `db`, `deps`, `web`, `api`,
  `shared-types`, `monorepo`, `config`, `release`.
- ❌ Не использовать `back` / `front` / `fullstack` в scope.

Примеры: `feat(board): add board CRUD`, `chore(monorepo): bootstrap pnpm workspaces`.

Сообщение проверяется commitlint автоматически — невалидное отклоняется.

## Хуки (husky)

- `pre-commit` → `lint-staged`: ESLint `--fix` + Prettier на staged-файлах.
- `commit-msg` → `commitlint`: проверка формата сообщения.

Хуки ставятся автоматически при `pnpm install` (скрипт `prepare`).

## Стиль кода

- Strict TypeScript, без `any` без явной причины.
- KISS / DRY / SOLID, маленькие изолированные функции и компоненты.
- Backend: слои `controller → service → repository` (с Prisma работает только репозиторий).
- Frontend: слои FSD `app / widgets / features / entities / shared`.
