import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { type BoardMember, getBoardMembers } from '@/entities/board';

import { boardMemberKeys } from './queryKeys';

/**
 * Список участников доски (SLT-42/43) — owner∪editor∪viewer видят (read, не управление, см.
 * контракт). Здесь — «как закэшировать», по образцу `useBoards`: ключ + queryFn поверх
 * `getBoardMembers` из entities («как позвать бэк»).
 *
 * `enabled` (дефолт `true`) — `ShareDialog` гасит запрос, пока сам закрыт (`enabled: false`):
 * список участников не нужен, пока диалог не открыт, а виджет держит `<ShareDialog>` смонтированным
 * заранее (контролируемый `open`, как у `ConfirmDialog`).
 */
export function useBoardMembers(boardId: string, enabled = true): UseQueryResult<BoardMember[]> {
  return useQuery({
    queryKey: boardMemberKeys.list(boardId),
    queryFn: ({ signal }) => getBoardMembers(boardId, signal),
    enabled,
  });
}
