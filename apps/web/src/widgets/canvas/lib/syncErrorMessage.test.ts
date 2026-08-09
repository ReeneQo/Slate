import { describe, expect, it } from 'vitest';

import { syncErrorMessage } from './syncErrorMessage';

describe('syncErrorMessage', () => {
  it('conflict — сообщает про правку другого участника', () => {
    expect(syncErrorMessage('conflict')).toMatch(/изменён другим участником/);
  });

  it('forbidden — сообщает про изменение доступа, а не про сбой сохранения', () => {
    const message = syncErrorMessage('forbidden');
    expect(message).toMatch(/доступ/i);
    expect(message).not.toMatch(/не удалось сохранить/i);
  });

  it('network — сообщает про проблему с сетью', () => {
    expect(syncErrorMessage('network')).toMatch(/сет/i);
  });
});
