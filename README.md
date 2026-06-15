# Slate

Совместный canvas-редактор (доски). Монорепо на **pnpm workspaces**.

> Turborepo, Docker и CI/CD добавляются отдельными задачами. Здесь — каркас и общие стандарты.

## Структура

```
slate/
├── apps/
│   ├── api/            # NestJS (feature-modular + repository) — заглушка
│   └── web/            # Vite + React (FSD) — заглушка
├── packages/
│   ├── database/       # Prisma schema + клиент (этап 2, пока пусто)
│   └── shared-types/   # Общие типы: элементы холста, DTO, контракты API
├── scripts/            # Служебные скрипты
├── docs/               # Документация
└── .github/            # Шаблоны / workflows (CI — позже)
```

## Стек

- **Монорепо:** pnpm workspaces (пакетный менеджер — только `pnpm`).
- **Backend** (`apps/api`): NestJS, Prisma + PostgreSQL, Redis, argon2, сессии.
- **Frontend** (`apps/web`): Vite + React (SPA), FSD, Konva, Zustand, react-query, react-hook-form + zod, Tailwind.
- **Shared:** `packages/database`, `packages/shared-types`.

## Требования

- Node.js `>=20.19`
- pnpm `>=11` (`corepack enable` подтянет нужную версию из `packageManager`)

## Установка

```bash
pnpm install
```

## Скрипты (корень)

| Команда             | Описание                       |
| ------------------- | ------------------------------ |
| `pnpm lint`         | ESLint по всему репо           |
| `pnpm lint:fix`     | ESLint с автофиксом            |
| `pnpm format`       | Prettier (запись)              |
| `pnpm format:check` | Prettier (проверка без записи) |

Скрипты конкретного пакета — через фильтр: `pnpm --filter @slate/web dev`.

## Конвенции

- **Коммиты:** Conventional Commits с доменным scope (`feat(board)`, `fix(canvas)`, …).
  Проверяются commitlint в хуке `commit-msg`.
- **Pre-commit:** lint-staged прогоняет ESLint + Prettier на staged-файлах.
- Подробнее — в [CONTRIBUTING.md](./CONTRIBUTING.md) и `CLAUDE.md`.
