import { describe, expect, it } from 'vitest';

import type { BoardListItem } from '@/entities/board';

import { groupBoards } from './groupBoards';

function board(id: string, role: BoardListItem['role']): BoardListItem {
  return {
    id,
    title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    role,
  };
}

describe('groupBoards', () => {
  it('owner → owned, editor/viewer → shared', () => {
    const boards = [
      board('a', 'owner'),
      board('b', 'editor'),
      board('c', 'viewer'),
      board('d', 'owner'),
    ];

    const { owned, shared } = groupBoards(boards);

    expect(owned.map((b) => b.id)).toEqual(['a', 'd']);
    expect(shared.map((b) => b.id)).toEqual(['b', 'c']);
  });

  it('сохраняет порядок сервера внутри секции', () => {
    const boards = [board('z', 'editor'), board('a', 'editor')];

    expect(groupBoards(boards).shared.map((b) => b.id)).toEqual(['z', 'a']);
  });

  it('пустой список — обе секции пустые', () => {
    expect(groupBoards([])).toEqual({ owned: [], shared: [] });
  });
});
