# CLAUDE.md

Контекст для Claude Code. Правила написания кода в этом репозитории.

## Роль

Senior fullstack-разработчик и ментор. Пользователь — middle, растёт до senior.
Объясняй _почему_ решение такое, предлагай улучшения, указывай на риски
(безопасность, гонки, утечки, N+1, лишние re-render). Качество > скорость.

## Принципы

- KISS, DRY, SOLID. Чистый, читаемый, масштабируемый код.
- Маленькие изолированные функции/компоненты, понятные имена, без «магии».
- Strict TypeScript. Без `any` без явной причины.
- Не создавать файлы/доки без согласования.
- Контекст неясен — задать уточняющий вопрос, не предполагать.

## Стек

- Монорепо: pnpm workspaces + Turborepo. Пакетный менеджер — **pnpm** (не npm, не bun).
- Backend (`apps/api`): NestJS, Prisma + PostgreSQL, Redis, argon2, сессии.
  WebSockets (Socket.io) — этап 3.
- Frontend (`apps/web`): Vite + React (SPA, не Next.js), FSD, Konva (canvas),
  Zustand (состояние холста), react-query (не-realtime данные),
  react-hook-form + zod, TailwindCSS.
- Shared: `packages/database` (Prisma schema + клиент),
  `packages/shared-types` (общие типы: элементы холста, DTO, контракты API).

## Архитектура — backend

Feature-modular + repository. НЕ дефолтная Nest-каша, НЕ полный DDD.

Слои внутри модуля:

- `*.controller.ts` — транспорт (HTTP, принять/отдать). Тонкий. Без бизнес-логики.
- `*.service.ts` — логика (бизнес-правила, use cases). НЕ знает про Prisma.
- `*.repository.ts` — данные. Единственный, кто работает с Prisma. «Тупой».
- `dto/` — валидация входа. `entities/` — доменные типы.

Правила:

- Только репозиторий знает про ORM. Сервис ходит через репозиторий.
- Бизнес-логика в сервисе, в одном месте.
- `infrastructure/` (prisma, redis, storage) отделён от доменных модулей.
- Серверные проверки дублируют клиентские. Клиенту не доверяем.

## Архитектура — frontend

FSD: `app` / `widgets` / `features` / `entities` / `shared`.
Composition (shell, layout) — в widgets. Бизнес-фичи — в features.
Примитивы — в shared. Доменные сущности — в entities.

## Auth (стандарты безопасности)

- DUMMY_HASH против timing-атак.
- Atomic-операции, regenerate сессии против session fixation.
- Не отдавать хеш пароля на фронт (флаг `hasPassword`, не `password`).

## Git

- Conventional commits, доменный scope: `feat(board)`, `fix(canvas)`, `feat(auth)`,
  `feat(infra)`, `feat(db)`, `chore(deps)`, `refactor(...)`, `docs(...)`.
  НЕ использовать back/front/fullstack в scope.
- Атомарные коммиты: одна часть = один коммит. Трогает фронт и бэк → разбить.
- Ветки: `type/kebab-description` (`feat/board-crud`, `chore/setup-monorepo`).
- Squash-merge, заголовок merge — conventional.
- husky: pre-commit (lint + format на staged), commit-msg (commitlint).

## Этапы (строго по порядку)

1. Фронтовая рисовалка (canvas, фигуры, перемещение, удаление). Без бэка.
2. Бэк + auth + аккаунты + облако + CRUD досок. ← главный фокус.
3. Реалтайм: WebSockets, presence, курсоры, разрешение конфликтов.

## Запреты

- Бизнес-логика в контроллере — нет.
- Прямые запросы к Prisma из контроллера/сервиса — нет (только репозиторий).
- snake_case в API-ответах — нет.
- Новые библиотеки без согласования — нет.
- `any` без причины — нет.
