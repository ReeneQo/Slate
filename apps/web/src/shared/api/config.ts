/**
 * Базовый URL API. Единственное место, где живёт адрес бэка.
 *
 * Источник — Vite-env (`VITE_API_URL`), НЕ хардкод: dev и прод целятся в разные хосты, а
 * значение вкомпиливается в бандл на этапе сборки. В деве это кросс-origin адрес Vite→Nest
 * (`http://localhost:3000/api`), в проде за reverse-proxy — относительный `/api` на том же
 * origin. Префикс `/api` — часть значения, а не хардкод здесь: так клиент остаётся доменно-
 * и транспорт-нейтральным и не знает про серверную маршрутизацию Nest (`setGlobalPrefix`).
 *
 * Фолбэк `/api` — корректное поведение для same-origin (прод за прокси): если переменная не
 * задана, запрос уходит на текущий origin. Это осознанный дефолт, а не «магия»: он ничего не
 * ломает молча — в кросс-origin деве без `.env` браузер сам упрётся в CORS, что видно сразу.
 */
const RAW_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

// Срезаем хвостовой слэш один раз, чтобы склейка с path была детерминированной.
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');

/**
 * Склейка базы и относительного пути в один URL. Абсолютный path (`/boards`) и относительный
 * (`boards`) дают один результат — вызывающему не нужно помнить про ведущий слэш.
 */
export function buildUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

/**
 * Базовый URL ws-сервера (SLT-37). Тот же Nest-инстанс, что и HTTP API, но БЕЗ префикса `/api`:
 * socket.io слушает на корне HTTP-сервера (`/socket.io`), а не под Nest global prefix. Поэтому
 * это не отдельная переменная окружения, а тот же `VITE_API_URL` с отрезанным `/api` — один
 * источник адреса бэка, а не два, которые могут разъехаться.
 *
 * Пустая строка (same-origin прод-фолбэк из API_BASE_URL) — валидный URL для socket.io-client:
 * `io('')` трактуется как «текущий origin», ровно то же поведение, что у fetch с относительным
 * path.
 */
export const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');
