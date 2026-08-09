import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/api';

import { mapInviteError, mapMemberListError, mapMemberMutationError } from './mapShareError';

describe('mapInviteError', () => {
  it('404 → пользователь не найден', () => {
    expect(mapInviteError(new ApiError(404, null, 'Not Found'))).toBe(
      'Пользователь с таким email не найден',
    );
  });

  it('409 → уже есть доступ (покрывает и дубль, и self-invite)', () => {
    expect(mapInviteError(new ApiError(409, null, 'Conflict'))).toBe(
      'У этого пользователя уже есть доступ к доске',
    );
  });

  it('429 → слишком много запросов', () => {
    expect(mapInviteError(new ApiError(429, null, 'Too Many Requests'))).toBe(
      'Слишком много запросов. Попробуйте позже.',
    );
  });

  it('прочий статус и не-ApiError → общее сообщение', () => {
    const generic = 'Что-то пошло не так. Попробуйте ещё раз.';
    expect(mapInviteError(new ApiError(500, null, 'Server Error'))).toBe(generic);
    expect(mapInviteError(new Error('boom'))).toBe(generic);
  });
});

describe('mapMemberMutationError', () => {
  it('404 → участник не найден', () => {
    expect(mapMemberMutationError(new ApiError(404, null, 'Not Found'))).toBe(
      'Участник не найден — возможно, уже удалён',
    );
  });

  it('прочий статус и не-ApiError → общее сообщение', () => {
    const generic = 'Что-то пошло не так. Попробуйте ещё раз.';
    expect(mapMemberMutationError(new ApiError(500, null, 'Server Error'))).toBe(generic);
    expect(mapMemberMutationError(new Error('boom'))).toBe(generic);
  });
});

describe('mapMemberListError', () => {
  it('429 → слишком много запросов', () => {
    expect(mapMemberListError(new ApiError(429, null, 'Too Many Requests'))).toBe(
      'Слишком много запросов. Попробуйте позже.',
    );
  });

  it('прочий статус и не-ApiError → общее сообщение загрузки', () => {
    const generic = 'Не удалось загрузить список участников. Попробуйте ещё раз.';
    expect(mapMemberListError(new ApiError(500, null, 'Server Error'))).toBe(generic);
    expect(mapMemberListError(new Error('network'))).toBe(generic);
  });
});
