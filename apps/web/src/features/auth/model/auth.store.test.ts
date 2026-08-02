import type { UserResponse } from '@slate/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from './auth.store';

const USER: UserResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  displayName: 'Renee',
  hasPassword: true,
  createdAt: '2026-08-03T00:00:00.000Z',
};

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
  });

  it('стартует в loading без пользователя (сессия ещё не проверена)', () => {
    // reset в beforeEach переводит в anonymous, поэтому проверяем INITIAL напрямую по типу:
    // важно, что дефолт стора — loading, а не anonymous (иначе мигнёт логином до /me).
    expect(useAuthStore.getInitialState().status).toBe('loading');
    expect(useAuthStore.getInitialState().user).toBeNull();
  });

  it('setAuthenticated кладёт пользователя и переводит в authenticated', () => {
    useAuthStore.getState().setAuthenticated(USER);

    const { status, user } = useAuthStore.getState();
    expect(status).toBe('authenticated');
    expect(user).toEqual(USER);
  });

  it('reset очищает пользователя и переводит в anonymous (идемпотентно)', () => {
    useAuthStore.getState().setAuthenticated(USER);

    useAuthStore.getState().reset();
    useAuthStore.getState().reset();

    const { status, user } = useAuthStore.getState();
    expect(status).toBe('anonymous');
    expect(user).toBeNull();
  });
});
