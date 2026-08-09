import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';

import { removeMember } from '@/entities/board';

import { boardMemberKeys } from './queryKeys';

/** Мутация отзыва участника (SLT-42/43, owner-only). Переменная — userId отзываемого. */
export function useRemoveMember(boardId: string): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => removeMember(boardId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardMemberKeys.list(boardId) }),
  });
}
