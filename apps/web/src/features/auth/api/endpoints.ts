/**
 * Пути auth-эндпоинтов — `as const` ВНУТРИ фичи: фича владеет своими путями, глобального файла
 * эндпоинтов нет намеренно (иначе он превратится в свалку путей всех фич). Базовый префикс/URL
 * (`/api`) уже в клиенте (SLT-24) — здесь только хвост. Объект, а не класс: пути — это данные.
 */
export const AUTH_ENDPOINTS = {
  login: '/auth/login',
  register: '/auth/register',
  logout: '/auth/logout',
  me: '/auth/me',
  /** `GET /auth/oauth/connect/:provider` — authorize-URL для входа через провайдера (SLT-52). */
  oauthConnect: (provider: string): string => `/auth/oauth/connect/${provider}`,
} as const;
