import type { InviteMemberInput } from '@slate/shared-types';
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';

import { type BoardMember, inviteMember } from '@/entities/board';

import { boardMemberKeys } from './queryKeys';

/**
 * Мутация приглашения участника (SLT-42/43, owner-only на бэке). После успеха — инвалидация
 * списка участников ЭТОЙ доски: сервер решает форму ответа (id членства, `createdAt`), источник
 * правды — перезапрос, тот же приём, что у `useCreateBoard`.
 *
 * Список досок (`boardKeys.all`) НЕ трогаем: инвайт меняет состав доски, а не роль/доступ
 * ПРИГЛАШАЮЩЕГО (он как был owner, так и остался) — его собственный `GET /boards` не изменится.
 */
export function useInviteMember(
  boardId: string,
): UseMutationResult<BoardMember, unknown, InviteMemberInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InviteMemberInput) => inviteMember(boardId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardMemberKeys.list(boardId) }),
  });
}
