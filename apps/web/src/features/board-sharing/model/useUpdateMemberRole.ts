import type { UpdateMemberRoleInput } from '@slate/shared-types';
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';

import { type BoardMember, updateMemberRole } from '@/entities/board';

import { boardMemberKeys } from './queryKeys';

/** Переменная мутации: кому (userId) меняем роль на что. */
export interface UpdateMemberRoleVariables {
  userId: string;
  input: UpdateMemberRoleInput;
}

/**
 * Мутация смены роли участника (editor↔viewer, SLT-42/43, owner-only). Инвалидация списка
 * участников после успеха — тот же приём, что у `useInviteMember`.
 */
export function useUpdateMemberRole(
  boardId: string,
): UseMutationResult<BoardMember, unknown, UpdateMemberRoleVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, input }: UpdateMemberRoleVariables) =>
      updateMemberRole(boardId, userId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardMemberKeys.list(boardId) }),
  });
}
