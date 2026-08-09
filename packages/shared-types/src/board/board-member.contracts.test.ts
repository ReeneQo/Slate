import { describe, expect, it } from 'vitest';

import { inviteMemberSchema, updateMemberRoleSchema } from './board.contracts.js';

/**
 * Тонкая проверка границ share-входов (SLT-42) — по тому же принципу, что у auth.contracts.test:
 * форму и совместимость с бэк-DTO стережёт компилятор (`implements` + `AssertExact`), а рантайм-
 * поведение границ проверяет фронт этими же схемами, поэтому тест живёт рядом с ними.
 */
describe('inviteMemberSchema', () => {
  it('принимает корректный вход', () => {
    const result = inviteMemberSchema.safeParse({ email: 'user@example.com', role: 'editor' });

    expect(result.success).toBe(true);
  });

  it('отвергает некорректный email', () => {
    const result = inviteMemberSchema.safeParse({ email: 'not-an-email', role: 'editor' });

    expect(result.success).toBe(false);
  });

  it('отвергает роль вне editor/viewer (в т.ч. owner)', () => {
    const result = inviteMemberSchema.safeParse({ email: 'user@example.com', role: 'owner' });

    expect(result.success).toBe(false);
  });

  it('отбрасывает лишние ключи, а не падает (whitelist-поведение бэка)', () => {
    const result = inviteMemberSchema.safeParse({
      email: 'user@example.com',
      role: 'editor',
      userId: 'smuggled',
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('userId');
  });
});

describe('updateMemberRoleSchema', () => {
  it('принимает editor и viewer', () => {
    expect(updateMemberRoleSchema.safeParse({ role: 'editor' }).success).toBe(true);
    expect(updateMemberRoleSchema.safeParse({ role: 'viewer' }).success).toBe(true);
  });

  it('отвергает owner и произвольную строку', () => {
    expect(updateMemberRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(updateMemberRoleSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
});
