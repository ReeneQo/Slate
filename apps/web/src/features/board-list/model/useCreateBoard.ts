import type { CreateBoardInput } from '@slate/shared-types';
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';

import { type Board, createBoard } from '@/entities/board';

import { boardKeys } from './queryKeys';

/**
 * Мутация создания доски. За хуком закреплена ОДНА кросс-сквозная забота — инвалидация кэша
 * списка после успеха: сервер посчитал сортировку (по updatedAt) и, возможно, дефолт title,
 * поэтому источник правды — перезапрос, а не ручная вставка в кэш.
 *
 * Инвалидация, а не оптимистичное добавление (SLT-22): создание разовое, лишний `GET /boards`
 * дёшев, а согласованность с сервером важнее мгновенности. KISS.
 *
 * Навигацию на новую доску хук НЕ делает намеренно: маршрутизация — забота UI, а не слоя кэша.
 * Вызывающий передаёт свой `onSuccess` в `mutate` (перейти на `boardPath(board.id)`); react-query
 * выполнит оба onSuccess — сначала этот (инвалидация), затем колбэк вызова.
 */
export function useCreateBoard(): UseMutationResult<Board, unknown, CreateBoardInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBoardInput) => createBoard(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardKeys.all }),
  });
}
