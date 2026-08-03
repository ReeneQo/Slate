import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { type Board, getBoards } from '@/entities/board';

import { boardKeys } from './queryKeys';

/**
 * Запрос списка досок. Здесь — «как закэшировать»: ключ + queryFn поверх `getBoards` из entities
 * («как позвать бэк»). Разделение сознательное: сущность не знает про кэш, фича не знает про
 * транспорт.
 *
 * `signal` react-query передаёт в queryFn и мы прокидываем его в `getBoards` — при уходе с экрана
 * или инвалидации незавершённый `GET /boards` отменяется, а не висит и не пишет в мёртвый кэш.
 *
 * Дефолты (retry не-4xx, staleTime, focus-refetch off) заданы на клиенте (createQueryClient) —
 * здесь их не переопределяем, чтобы поведение списка было предсказуемо-единым.
 */
export function useBoards(): UseQueryResult<Board[]> {
  return useQuery({
    queryKey: boardKeys.all,
    queryFn: ({ signal }) => getBoards(signal),
  });
}
