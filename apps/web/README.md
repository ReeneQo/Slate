# @slate/web

Frontend на **Vite + React** (SPA, не Next.js). Архитектура — **FSD** (Feature-Sliced Design).

## Запуск

```bash
pnpm --filter @slate/web dev
```

## Слои FSD

```
src/
├── app/        # инициализация приложения: провайдеры, роутер, глобальные стили
├── widgets/    # композиция (shell, layout) из фич и сущностей
├── features/   # бизнес-фичи (пользовательские сценарии)
├── entities/   # доменные сущности (элементы холста, доска, пользователь)
└── shared/     # примитивы: ui-kit, lib, api, config — без бизнес-логики
```

Зависимости направлены вниз: `app → widgets → features → entities → shared`.
Слой импортирует только из слоёв ниже.

## Алиасы

`@/*` → `src/*` (настроено в `tsconfig.json` и `vite.config.ts`).

> Каркас этапа 1. Конкретный стек холста — Konva, Zustand, react-query,
> react-hook-form + zod, TailwindCSS — подключается в задаче «рисовалка».
