import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.constants.js';
import { loginInputSchema, registerInputSchema } from './auth.contracts.js';

/**
 * Тонкая проверка границ auth-входов. Форму и совместимость с бэк-DTO стережёт компилятор
 * (`implements LoginInput/RegisterInput` + `AssertExact` в apps/api), а вот РАНТАЙМ-поведение
 * границ (что именно схема принимает и отвергает) не проверяет там никто — это делает фронт
 * этими же схемами, поэтому тест живёт рядом со схемой.
 */
describe('loginInputSchema', () => {
  const validPassword = 'a'.repeat(PASSWORD_MIN_LENGTH);

  it('принимает корректный вход', () => {
    const result = loginInputSchema.safeParse({
      email: 'user@example.com',
      password: validPassword,
    });

    expect(result.success).toBe(true);
  });

  it('отвергает некорректный email', () => {
    const result = loginInputSchema.safeParse({ email: 'not-an-email', password: validPassword });

    expect(result.success).toBe(false);
  });

  it('отвергает пароль короче нижней границы', () => {
    const result = loginInputSchema.safeParse({
      email: 'user@example.com',
      password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
    });

    expect(result.success).toBe(false);
  });

  it('отвергает пароль длиннее верхней границы', () => {
    const result = loginInputSchema.safeParse({
      email: 'user@example.com',
      password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it('отбрасывает лишние ключи, а не падает (whitelist-поведение бэка)', () => {
    const result = loginInputSchema.safeParse({
      email: 'user@example.com',
      password: validPassword,
      role: 'admin',
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('role');
  });
});

describe('registerInputSchema', () => {
  const validInput = {
    email: 'user@example.com',
    displayName: 'Renee',
    password: 'a'.repeat(PASSWORD_MIN_LENGTH),
  };

  it('принимает корректный вход', () => {
    expect(registerInputSchema.safeParse(validInput).success).toBe(true);
  });

  it('отвергает пустое имя', () => {
    const result = registerInputSchema.safeParse({ ...validInput, displayName: '' });

    expect(result.success).toBe(false);
  });
});
