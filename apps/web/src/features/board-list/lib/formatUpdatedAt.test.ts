import { describe, expect, it } from 'vitest';

import { formatUpdatedAt } from './formatUpdatedAt';

describe('formatUpdatedAt', () => {
  it('форматирует ISO-строку в дату ru-RU', () => {
    // 2026-08-03 → «3 авг. 2026 г.» (формат ru-RU, day/month-short/year).
    expect(formatUpdatedAt('2026-08-03T12:00:00.000Z')).toContain('2026');
    expect(formatUpdatedAt('2026-08-03T12:00:00.000Z')).toContain('авг');
  });

  it('битую дату не роняет, возвращает пустую строку', () => {
    expect(formatUpdatedAt('not-a-date')).toBe('');
  });
});
