/**
 * Публичная поверхность транспортного слоя. Фичи импортируют отсюда (`@/shared/api`), а не из
 * внутренних модулей — так внутренняя раскладка файлов остаётся деталью реализации.
 */
export { API_BASE_URL, SOCKET_URL } from './config';
export { ApiError, type ApiErrorBody, isApiError } from './http-error';
export { request, type RequestOptions } from './request';
export { registerUnauthorizedHandler } from './unauthorized';
