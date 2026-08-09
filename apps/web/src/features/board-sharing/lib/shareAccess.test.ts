import { describe, expect, it } from 'vitest';

import { getShareDialogAccess } from './shareAccess';

describe('getShareDialogAccess', () => {
  it('owner → full (управление)', () => {
    expect(getShareDialogAccess('owner')).toBe('full');
  });

  it('editor → readonly (только список)', () => {
    expect(getShareDialogAccess('editor')).toBe('readonly');
  });

  it('viewer → none (диалог не открывается)', () => {
    expect(getShareDialogAccess('viewer')).toBe('none');
  });
});
