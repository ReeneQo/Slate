import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api';

import { mapBoardListError, mapBoardMutationError } from './mapBoardError';

describe('mapBoardListError', () => {
  it('429 → слишком много запросов', () => {
    expect(mapBoardListError(new ApiError(429, null, 'Too Many Requests'))).toBe(
      'Слишком много запросов. Попробуйте позже.',
    );
  });

  it('прочий статус и не-ApiError → общее сообщение загрузки', () => {
    const generic = 'Не удалось загрузить доски. Попробуйте ещё раз.';
    expect(mapBoardListError(new ApiError(500, null, 'Server Error'))).toBe(generic);
    expect(mapBoardListError(new Error('network'))).toBe(generic);
  });
});

describe('mapBoardMutationError', () => {
  it('404 → доска уже удалена', () => {
    expect(mapBoardMutationError(new ApiError(404, null, 'Not Found'))).toBe(
      'Доска не найдена — возможно, она уже удалена.',
    );
  });

  it('429 → слишком много запросов', () => {
    expect(mapBoardMutationError(new ApiError(429, null, 'Too Many Requests'))).toBe(
      'Слишком много запросов. Попробуйте позже.',
    );
  });

  it('прочий статус и не-ApiError → общее сообщение', () => {
    const generic = 'Что-то пошло не так. Попробуйте ещё раз.';
    expect(mapBoardMutationError(new ApiError(500, null, 'Server Error'))).toBe(generic);
    expect(mapBoardMutationError(new Error('boom'))).toBe(generic);
  });
});
