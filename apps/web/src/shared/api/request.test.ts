import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, isApiError } from './http-error';
import { request } from './request';
import { registerUnauthorizedHandler } from './unauthorized';

/**
 * Мокаем глобальный fetch: тестируем контракт обёртки (credentials, заголовки, разбор тела,
 * типизированную ошибку, точку 401), а не сеть. Response/Headers — нативные (Node 22).
 */
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** Init последнего вызова fetch. Отдельный хелпер — noUncheckedIndexedAccess требует проверки. */
function lastRequestInit(): RequestInit {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) {
    throw new Error('fetch не был вызван');
  }
  return call[1] ?? {};
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('request', () => {
  it('шлёт запрос с credentials:include и парсит JSON-ответ в тип T', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'b1' }));

    // Act
    const result = await request<{ id: string }>('/boards');

    // Assert
    expect(result).toEqual({ id: 'b1' });
    const init = lastRequestInit();
    expect(init?.credentials).toBe('include');
  });

  it('сериализует json-тело и проставляет Content-Type', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 201 }));

    // Act
    await request('/boards', { method: 'POST', json: { name: 'Slate' } });

    // Assert
    const init = lastRequestInit();
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'Slate' }));
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('не ставит Content-Type, когда тела нет', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    // Act
    await request('/boards');

    // Assert
    const init = lastRequestInit();
    expect(new Headers(init?.headers).get('content-type')).toBeNull();
  });

  it('на 204 возвращает undefined, не пытаясь распарсить пустое тело', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    // Act
    const result = await request<void>('/boards/b1', { method: 'DELETE' });

    // Assert
    expect(result).toBeUndefined();
  });

  it('на не-2xx бросает ApiError с httpStatus и распарсенным payload', async () => {
    // Arrange
    const body = { statusCode: 409, message: 'Пользователь уже существует', error: 'Conflict' };
    fetchMock.mockResolvedValueOnce(jsonResponse(body, { status: 409 }));

    // Act
    const promise = request('/auth/register', { method: 'POST', json: {} });

    // Assert
    await expect(promise).rejects.toMatchObject({ status: 409, payload: body });
    await promise.catch((error: unknown) => {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.message).toBe('Пользователь уже существует');
      }
    });
  });

  it('склеивает массив message (ошибки валидации) в message ошибки', async () => {
    // Arrange
    const body = { statusCode: 400, message: ['name обязателен', 'name слишком длинный'] };
    fetchMock.mockResolvedValueOnce(jsonResponse(body, { status: 400 }));

    // Act & Assert
    await request('/boards', { method: 'POST', json: {} }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      if (isApiError(error)) {
        expect(error.message).toBe('name обязателен; name слишком длинный');
      }
    });
  });
});

describe('обработка 401', () => {
  it('уведомляет зарегистрированный обработчик и всё равно бросает ошибку', async () => {
    // Arrange
    const handler = vi.fn();
    const unregister = registerUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: 'Требуется авторизация' }, { status: 401 }),
    );

    // Act & Assert
    await expect(request('/boards')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();

    unregister();
  });

  it('не уведомляет обработчик при suppressUnauthorized (сценарий логина)', async () => {
    // Arrange
    const handler = vi.fn();
    const unregister = registerUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: 'Неверные учётные данные' }, { status: 401 }),
    );

    // Act & Assert
    await expect(
      request('/auth/login', { method: 'POST', json: {}, suppressUnauthorized: true }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();

    unregister();
  });

  it('unregister снимает обработчик', async () => {
    // Arrange
    const handler = vi.fn();
    const unregister = registerUnauthorizedHandler(handler);
    unregister();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: 'Требуется авторизация' }, { status: 401 }),
    );

    // Act & Assert
    await expect(request('/boards')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });
});
