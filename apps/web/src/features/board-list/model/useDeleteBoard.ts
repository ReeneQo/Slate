import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';

import { deleteBoard } from '@/entities/board';

import { boardKeys } from './queryKeys';

/**
 * Мутация удаления доски. После успеха — инвалидация списка (перезапрос отражает удаление и
 * сохраняет серверную сортировку).
 *
 * Без оптимистичного удаления (SLT-22): удаление по сети быстрое, короткое мерцание строки до
 * рефетча некритично, а откат оптимистичной мутации при ошибке — лишняя сложность на ровном
 * месте. KISS: инвалидация после успеха.
 *
 * Тип переменной мутации — `string` (id доски). Подтверждение показывает UI перед вызовом
 * `mutate` — тут о нём знать не нужно.
 */
export function useDeleteBoard(): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteBoard(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardKeys.all }),
  });
}
