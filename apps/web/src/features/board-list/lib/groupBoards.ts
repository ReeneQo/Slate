import type { BoardListItem } from '@/entities/board';

export interface GroupedBoards {
  /** `role === 'owner'` — доски, созданные текущим пользователем. */
  owned: BoardListItem[];
  /** `role !== 'owner'` (editor/viewer) — доски, расшаренные с текущим пользователем. */
  shared: BoardListItem[];
}

/**
 * Группировка `GET /boards` (owned ∪ shared, SLT-42) на секции списка (SLT-43, решение 4):
 * «Мои доски» / «Доступные мне» — а не плоский список с бейджем. Один запрос, группировка на
 * клиенте (SLT-43, границы: НЕ отдельные запросы под секции) — по полю `role`, которое уже несёт
 * каждый элемент списка.
 *
 * Порядок ВНУТРИ каждой секции сохраняется — сервер уже отсортировал (по `updatedAt`), фильтрация
 * этот порядок не трогает.
 */
export function groupBoards(boards: BoardListItem[]): GroupedBoards {
  const owned: BoardListItem[] = [];
  const shared: BoardListItem[] = [];

  for (const board of boards) {
    (board.role === 'owner' ? owned : shared).push(board);
  }

  return { owned, shared };
}
