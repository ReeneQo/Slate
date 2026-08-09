import type { BoardAccessRole } from '@slate/shared-types';
import { useQuery } from '@tanstack/react-query';

import { getBoards } from '@/entities/board';

import { boardKeys } from './queryKeys';

/**
 * Роль текущего пользователя на КОНКРЕТНОЙ доске (SLT-43) — селектор поверх ТОГО ЖЕ кэша, что и
 * `useBoards` (`boardKeys.all`), не отдельный запрос. `GET /boards/:id` роли не несёт (SLT-42,
 * контракт), а заводить под одну доску отдельный эндпоинт — трогать бэк (вне границ SLT-43).
 * Единственный источник роли — уже существующий `GET /boards`, он же наполняет дашборд.
 *
 * Одинаковый `queryKey` с `useBoards` — react-query делит кэш: если список досок уже загружен
 * (обычный путь — открыли доску кликом из дашборда), роль приходит МГНОВЕННО без сетевого
 * запроса. Прямой заход по URL (обновление страницы на `/boards/:id`) один раз перезапросит
 * список — тот же `GET /boards`, которым и так открывается дашборд, лишнего эндпоинта нет.
 *
 * `select` — трансформация БЕЗ лишнего ре-рендера при неизменном результате (react-query сверяет
 * его по ссылке/значению): смена элементов, не затрагивающая эту доску, не дёргает гейт холста.
 *
 * Доска не найдена в списке (ещё грузится / чужая / удалена) → `undefined` — `deriveCanEdit`
 * трактует это как безопасный read-only дефолт, а не как «доступ есть, просто роль неизвестна».
 */
export function useBoardRole(boardId: string): BoardAccessRole | undefined {
  const { data } = useQuery({
    queryKey: boardKeys.all,
    queryFn: ({ signal }) => getBoards(signal),
    select: (boards) => boards.find((board) => board.id === boardId)?.role,
  });

  return data;
}
