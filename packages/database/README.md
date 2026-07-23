# @slate/database

Единый источник схемы данных: **Prisma schema** + сгенерированный клиент.
Этот пакет — единственное место, где живёт ORM; репозитории `apps/api` импортируют клиент отсюда.

## Потребление (source-first)

Пакет НЕ билдится отдельно. `exports` указывает на TS-исходник (`src/index.ts`),
потребитель компилирует его в своей сборке. Пакет реэкспортит **класс** `PrismaClient`,
namespace `Prisma` и типы моделей — **инстанс не создаётся** (синглтон-обёртка живёт в
`apps/api`, SLT-12).

```ts
import { PrismaClient, Prisma } from '@slate/database';
```

## Структура

```
packages/database/
├── prisma/
│   └── schema.prisma      # datasource + generator + модели (сейчас — заглушка HealthCheck)
├── prisma.config.ts       # конфиг Prisma 7: путь к схеме + datasource.url (для Migrate)
├── generated/client/      # сгенерированный TS-клиент (gitignored)
└── src/index.ts           # реэкспорт PrismaClient + типов
```

## Prisma 7

- **Generator** — `prisma-client` (новый, эмитит TS; ложится на source-first).
- **Datasource url** в Prisma 7 вынесен из схемы в `prisma.config.ts`.
- **Driver adapter** (`@prisma/adapter-pg` + `pg`) понадобится в `apps/api` при создании
  инстанса `PrismaClient` — это задача SLT-12, не этого пакета.

## Скрипты

- `pnpm --filter @slate/database db:generate` — генерация клиента (коннект к БД не нужен).
- `db:migrate` / `db:studio` — миграции и Studio (требуют настроенного `DATABASE_URL`, SLT-12).

> Заглушка `HealthCheck` в схеме нужна лишь потому, что Prisma не генерирует клиент из
> пустой схемы. Реальные модели (User/Board/Element) — блок 1.
