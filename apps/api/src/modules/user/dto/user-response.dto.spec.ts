import type { SafeUser, UserWithHash } from '../entities/user.entity';
import { toUserResponse } from './user-response.dto';

const SAFE_USER: SafeUser = {
  id: '019fa40d-6841-70ed-8b1d-7c64e6411bd6',
  email: 'user@example.com',
  displayName: 'Renee',
  createdAt: new Date('2026-07-27T14:49:29.922Z'),
  updatedAt: new Date('2026-07-27T14:49:29.922Z'),
};

/**
 * Пользователь С хешем. Ключевой момент: `UserWithHash` — структурный супертип
 * `SafeUser`, поэтому такой объект проходит в `toUserResponse` БЕЗ каста и без `any`.
 * Именно поэтому регресс-тест ниже вообще возможен и имеет смысл.
 */
const USER_WITH_HASH: UserWithHash = {
  ...SAFE_USER,
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$fake-hash-for-test',
};

describe('toUserResponse', () => {
  it('отдаёт ровно поля контракта', () => {
    const result = toUserResponse(SAFE_USER, true);

    expect(result).toEqual({
      id: SAFE_USER.id,
      email: SAFE_USER.email,
      displayName: SAFE_USER.displayName,
      hasPassword: true,
      createdAt: SAFE_USER.createdAt,
    });
    // toEqual сверяет значения; ключи фиксируем отдельно, чтобы новое поле в модели
    // не уехало в ответ незамеченным.
    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'hasPassword',
      'id',
    ]);
  });

  it('не пропускает passwordHash наружу, даже если получил объект с хешем', () => {
    const result = toUserResponse(USER_WITH_HASH, true);

    // РЕГРЕСС на дефект старого auth-проекта: там хеш уезжал на фронт вместе со всем
    // объектом пользователя. Тип входа (SafeUser) от этого не защищает — hash-несущий
    // объект ему структурно соответствует. Защищает только то, что маппер перечисляет
    // поля поимённо; замена перечисления на `{ ...user }` уронит именно этот тест.
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('argon2');
  });

  it('ставит hasPassword=false, когда хеша нет (OAuth-пользователь)', () => {
    const oauthUser: UserWithHash = { ...SAFE_USER, passwordHash: null };

    const result = toUserResponse(oauthUser, oauthUser.passwordHash !== null);

    expect(result.hasPassword).toBe(false);
    expect(result).not.toHaveProperty('passwordHash');
  });
});
