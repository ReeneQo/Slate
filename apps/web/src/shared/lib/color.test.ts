import { describe, expect, it } from 'vitest';

import { colorForUserId } from './color';

describe('colorForUserId', () => {
  it('возвращает один и тот же цвет для одного и того же userId', () => {
    // Arrange
    const userId = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';

    // Act
    const first = colorForUserId(userId);
    const second = colorForUserId(userId);

    // Assert
    expect(first).toBe(second);
  });

  it('возвращает цвет в формате hex из фиксированной палитры', () => {
    // Arrange & Act
    const color = colorForUserId('some-user-id');

    // Assert
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('разным userId обычно достаются разные цвета', () => {
    // Arrange & Act
    const a = colorForUserId('user-a');
    const b = colorForUserId('user-b');

    // Assert
    expect(a).not.toBe(b);
  });
});
