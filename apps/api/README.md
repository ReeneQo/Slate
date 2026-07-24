# @slate/api

Backend на **NestJS**. Архитектура: **feature-modular + repository** (не дефолтная Nest-каша, не полный DDD).

## Запуск

```bash
pnpm --filter @slate/api dev
```

## Структура

```
src/
├── main.ts                # точка входа (bootstrap)
├── app.module.ts          # корневой модуль
├── modules/               # доменные feature-модули (health реализован; board, auth — блок 2)
├── infrastructure/        # prisma, redis, storage — отделено от домена (наполняется в SLT-12)
├── config/                # конфиг приложения (zod-валидация env — SLT-12)
└── shared/                # decorators, guards, filters, utils — переиспользуемые примитивы
```

## Слои внутри доменного модуля

```
modules/<feature>/
├── <feature>.controller.ts   # транспорт (HTTP). Тонкий, без бизнес-логики.
├── <feature>.service.ts      # бизнес-правила / use cases. НЕ знает про Prisma.
├── <feature>.repository.ts   # данные. Единственный, кто работает с Prisma. «Тупой».
├── <feature>.module.ts       # сборка модуля
├── dto/                      # валидация входа (class-validator / zod)
└── entities/                # доменные типы
```

## Правила

- С Prisma работает **только репозиторий**. Сервис ходит в данные через репозиторий.
- Бизнес-логика — в сервисе, в одном месте. Контроллер только принимает/отдаёт.
- Серверные проверки дублируют клиентские. Клиенту не доверяем.
- В API-ответах — `camelCase`, без `snake_case`.

> Это каркас этапа 1. Реальные модули (auth, board CRUD) появятся на этапе 2.
