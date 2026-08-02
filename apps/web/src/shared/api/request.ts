import { buildUrl } from './config';
import { ApiError, extractErrorMessage } from './http-error';
import { notifyUnauthorized } from './unauthorized';

/**
 * Транспортный слой: тонкая типизированная обёртка над fetch. Доменно-нейтральна — знает про
 * HTTP/JSON/статусы/ошибки, но НЕ про auth/board/element. Тип ответа задаёт вызывающая сторона
 * через дженерик `T`; доменные контракты (в т.ч. из @slate/shared-types) подключат фичи в
 * SLT-25/26/27, здесь их нет намеренно.
 */

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** Тело запроса. Сериализуется в JSON; заголовок Content-Type проставляется автоматически. */
  json?: unknown;
  /** Доп. заголовки поверх дефолтных (Accept, Content-Type). */
  headers?: HeadersInit;
  /** Для отмены запроса (react-query передаёт свой signal). */
  signal?: AbortSignal;
  /**
   * Не уведомлять обработчик 401 для этого запроса. Нужен ровно одному сценарию: сам логин
   * (SLT-25) на неверный пароль отвечает 401, и трактовать его как «сессия истекла → сбросить
   * auth» неверно. Клиент доменно-нейтрален и не знает, какой путь — логин, поэтому решение
   * отдаётся вызывающему через явный флаг. По умолчанию 401 всегда уведомляет.
   */
  suppressUnauthorized?: boolean;
}

/**
 * Читает тело ответа ОДИН раз. 204/пустое тело → undefined. JSON парсим по content-type;
 * если сервер соврал про тип или отдал битый JSON — возвращаем сырой текст, не падаем: разбор
 * ошибки не должен маскировать исходный статус.
 */
async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', json, headers, signal, suppressUnauthorized = false } = options;

  const hasBody = json !== undefined;

  const response = await fetch(buildUrl(path), {
    method,
    // Куки-сессии блока 2: без include браузер не пошлёт session-куку на кросс-origin (5173→3000).
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      // Content-Type ставим только когда реально есть тело — иначе на GET он бессмысленен.
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: hasBody ? JSON.stringify(json) : undefined,
  });

  const payload = await parseBody(response);

  if (!response.ok) {
    // 401 — единая точка: уведомляем зарегистрированный обработчик (SLT-25 сбросит auth), но
    // ПОСЛЕ этого всё равно бросаем ошибку, чтобы вызывающий тоже мог отреагировать.
    if (response.status === 401 && !suppressUnauthorized) {
      notifyUnauthorized();
    }

    throw new ApiError(response.status, payload, extractErrorMessage(response.status, payload));
  }

  // Успех: типизацию ответа гарантирует вызывающий через T. Для 204/пустого тела T должен
  // допускать undefined (напр. `request<void>`).
  return payload as T;
}
