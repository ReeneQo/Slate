import { describe, expect, it } from 'vitest';

import {
  applyCursorLeave,
  applyCursorMove,
  applyPresenceJoin,
  applyPresenceLeave,
  applyPresenceSnapshot,
  withoutKey,
} from './presence-reducers';
import type { RemoteCursor } from './realtime.store';

const USER_A = { userId: 'user-a', displayName: 'Alice' };
const USER_B = { userId: 'user-b', displayName: 'Bob' };

describe('applyPresenceSnapshot', () => {
  it('полностью заменяет онлайн-список содержимым снимка', () => {
    // Arrange
    const payload = { users: [USER_A, USER_B] };

    // Act
    const patch = applyPresenceSnapshot(payload);

    // Assert
    expect(patch.onlineUsers).toEqual([USER_A, USER_B]);
  });
});

describe('applyPresenceJoin', () => {
  it('добавляет нового участника в список онлайна', () => {
    // Arrange
    const onlineUsers = [USER_A];

    // Act
    const patch = applyPresenceJoin(onlineUsers, USER_B);

    // Assert
    expect(patch.onlineUsers).toEqual([USER_A, USER_B]);
  });

  it('не дублирует уже присутствующего участника (гонка snapshot/join)', () => {
    // Arrange
    const onlineUsers = [USER_A, USER_B];

    // Act
    const patch = applyPresenceJoin(onlineUsers, USER_A);

    // Assert
    expect(patch.onlineUsers).toEqual([USER_A, USER_B]);
  });
});

describe('applyPresenceLeave', () => {
  it('убирает участника из онлайна и его курсор', () => {
    // Arrange
    const onlineUsers = [USER_A, USER_B];
    const cursors: Record<string, RemoteCursor> = {
      [USER_A.userId]: { ...USER_A, x: 1, y: 2 },
      [USER_B.userId]: { ...USER_B, x: 3, y: 4 },
    };

    // Act
    const patch = applyPresenceLeave(onlineUsers, cursors, { userId: USER_A.userId });

    // Assert
    expect(patch.onlineUsers).toEqual([USER_B]);
    expect(patch.cursors).toEqual({ [USER_B.userId]: { ...USER_B, x: 3, y: 4 } });
  });
});

describe('applyCursorMove', () => {
  it('добавляет курсор нового участника, резолвя displayName из онлайн-списка', () => {
    // Arrange & Act
    const patch = applyCursorMove({}, [USER_A], { userId: USER_A.userId, x: 5, y: 6 });

    // Assert
    expect(patch.cursors).toEqual({ [USER_A.userId]: { ...USER_A, x: 5, y: 6 } });
  });

  it('обновляет позицию уже известного курсора', () => {
    // Arrange
    const cursors: Record<string, RemoteCursor> = { [USER_A.userId]: { ...USER_A, x: 0, y: 0 } };

    // Act
    const patch = applyCursorMove(cursors, [USER_A], { userId: USER_A.userId, x: 9, y: 9 });

    // Assert
    expect(patch.cursors).toEqual({ [USER_A.userId]: { ...USER_A, x: 9, y: 9 } });
  });

  it('падает на userId, если участника нет ни в онлайн-списке, ни в предыдущем курсоре (гонка)', () => {
    // Arrange & Act
    const patch = applyCursorMove({}, [], { userId: USER_A.userId, x: 1, y: 1 });

    // Assert
    expect(patch.cursors[USER_A.userId]?.displayName).toBe(USER_A.userId);
  });
});

describe('applyCursorLeave', () => {
  it('убирает курсор конкретного участника, не трогая остальных', () => {
    // Arrange
    const cursors: Record<string, RemoteCursor> = {
      [USER_A.userId]: { ...USER_A, x: 1, y: 2 },
      [USER_B.userId]: { ...USER_B, x: 3, y: 4 },
    };

    // Act
    const patch = applyCursorLeave(cursors, { userId: USER_A.userId });

    // Assert
    expect(patch.cursors).toEqual({ [USER_B.userId]: { ...USER_B, x: 3, y: 4 } });
  });
});

describe('withoutKey', () => {
  it('возвращает тот же объект по ссылке, если ключа и так нет (нет лишней аллокации)', () => {
    // Arrange
    const record = { a: 1 };

    // Act
    const result = withoutKey(record, 'missing');

    // Assert
    expect(result).toBe(record);
  });
});
