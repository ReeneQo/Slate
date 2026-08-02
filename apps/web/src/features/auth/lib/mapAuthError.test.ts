import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api';

import { mapLoginError, mapRegisterError } from './mapAuthError';

describe('mapLoginError', () => {
  it('401 → неверные креды', () => {
    expect(mapLoginError(new ApiError(401, null, 'Unauthorized'))).toBe(
      'Неверный email или пароль',
    );
  });

  it('429 → слишком много попыток', () => {
    expect(mapLoginError(new ApiError(429, null, 'Too Many Requests'))).toBe(
      'Слишком много попыток. Попробуйте позже.',
    );
  });

  it('прочий статус и не-ApiError → общее сообщение', () => {
    const generic = 'Что-то пошло не так. Попробуйте ещё раз.';
    expect(mapLoginError(new ApiError(500, null, 'Server Error'))).toBe(generic);
    expect(mapLoginError(new Error('network'))).toBe(generic);
  });
});

describe('mapRegisterError', () => {
  it('409 → email уже занят', () => {
    expect(mapRegisterError(new ApiError(409, null, 'Conflict'))).toBe(
      'Пользователь с таким email уже существует',
    );
  });

  it('401 на регистрации не трактуется как «email занят»', () => {
    expect(mapRegisterError(new ApiError(401, null, 'Unauthorized'))).toBe(
      'Что-то пошло не так. Попробуйте ещё раз.',
    );
  });
});
