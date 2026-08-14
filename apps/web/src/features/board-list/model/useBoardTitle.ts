import { useQuery } from '@tanstack/react-query';

import { getBoards } from '@/entities/board';

import { boardKeys } from './queryKeys';

/**
 * Название КОНКРЕТНОЙ доски (SLT-66, экспорт PNG) — селектор поверх ТОГО ЖЕ кэша, что и
 * `useBoards`/`useBoardRole` (`boardKeys.all`), не отдельный запрос. Зеркало `useBoardRole`:
 * тот же `GET /boards`, та же логика «список уже загружен — доска мгновенно из кэша, прямой заход
 * по URL — один перезапрос».
 *
 * Доска не найдена в списке (ещё грузится / удалена) → `undefined` — вызывающий (имя файла
 * экспорта) откатывается на `boardId`.
 */
export function useBoardTitle(boardId: string): string | undefined {
  const { data } = useQuery({
    queryKey: boardKeys.all,
    queryFn: ({ signal }) => getBoards(signal),
    select: (boards) => boards.find((board) => board.id === boardId)?.title,
  });

  return data;
}
