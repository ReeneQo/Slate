import { describe, expect, it } from 'vitest';

import { deriveCanEdit } from './canEdit';

describe('deriveCanEdit', () => {
  it('owner — может редактировать', () => {
    expect(deriveCanEdit('owner')).toBe(true);
  });

  it('editor — может редактировать', () => {
    expect(deriveCanEdit('editor')).toBe(true);
  });

  it('viewer — read-only', () => {
    expect(deriveCanEdit('viewer')).toBe(false);
  });

  it('роль ещё не известна (undefined) — безопасный дефолт read-only', () => {
    expect(deriveCanEdit(undefined)).toBe(false);
  });
});
