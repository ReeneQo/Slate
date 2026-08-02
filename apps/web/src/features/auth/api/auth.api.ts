import type {
  AuthUserResponse,
  LoginInput,
  RegisterInput,
  UserResponse,
} from '@slate/shared-types';

import { request } from '@/shared/api';

import { AUTH_ENDPOINTS } from './endpoints';

/**
 * Обёртки auth поверх доменно-нейтрального `request<T>` (SLT-24). Функции, не класс: у auth-API
 * нет состояния, инкапсулировать нечего. Типы ввода/вывода — из контракта (@slate/shared-types).
 */

/**
 * Логин. `suppressUnauthorized: true` — это не деталь, а корректность: на неверный пароль бэк
 * отвечает 401, но это НЕ «сессия истекла» (мы и не были залогинены). Без флага сработал бы
 * глобальный onUnauthorized → сброс auth-стора — бессмысленно здесь. Сам 401 всё равно
 * прилетит исключением, и его в сообщение маппит форма (mapLoginError).
 */
export function login(input: LoginInput): Promise<AuthUserResponse> {
  return request<AuthUserResponse>(AUTH_ENDPOINTS.login, {
    method: 'POST',
    json: input,
    suppressUnauthorized: true,
  });
}

export function register(input: RegisterInput): Promise<AuthUserResponse> {
  return request<AuthUserResponse>(AUTH_ENDPOINTS.register, {
    method: 'POST',
    json: input,
  });
}

/** 204 No Content — тела нет, поэтому `request<void>`. */
export function logout(): Promise<void> {
  return request<void>(AUTH_ENDPOINTS.logout, { method: 'POST' });
}

export function getMe(): Promise<UserResponse> {
  return request<UserResponse>(AUTH_ENDPOINTS.me);
}
