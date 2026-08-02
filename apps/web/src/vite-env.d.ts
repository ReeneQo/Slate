/// <reference types="vite/client" />

/**
 * Типы Vite-env. Даёт автокомплит и strict-проверку на `import.meta.env.VITE_*`.
 * Только `VITE_`-префикс попадает в клиентский бандл (правило Vite) — остальное недоступно.
 */
interface ImportMetaEnv {
  /** Базовый URL API, включая префикс `/api`. Не задан → same-origin `/api` (прод за прокси). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
