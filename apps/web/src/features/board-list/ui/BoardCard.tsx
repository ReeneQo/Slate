import type { BoardAccessRole } from '@slate/shared-types';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import type { BoardListItem } from '@/entities/board';
import { boardPath } from '@/shared/config';

import { formatUpdatedAt } from '../lib/formatUpdatedAt';

/**
 * Подпись роли на карточке shared-доски (SLT-43, решение 4) — русские ярлыки. `owner` в записи
 * есть только ради типа (полный `BoardAccessRole`, без него индексация `board.role` требовала бы
 * ручного сужения типа в JSX) — рендерится он лишь под `!isOwner`, куда никогда не долетает.
 */
const ROLE_LABEL: Record<BoardAccessRole, string> = {
  owner: 'Владелец',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

interface BoardCardProps {
  board: BoardListItem;
  onDelete: (board: BoardListItem) => void;
  onShare: (board: BoardListItem) => void;
}

/**
 * Карточка доски в списке. Заголовок — ссылка на холст доски: переход через `boardPath`, а не
 * ручную склейку URL. Кнопки удаления/шеринга вынесены ИЗ ссылки (соседние элементы, не
 * вложенные): интерактив внутри интерактива — и невалидный HTML, и ловушка для клика/фокуса.
 *
 * Действия по роли (SLT-43, решение 4): удалить и «Поделиться» — ТОЛЬКО `owner` (единственный,
 * кому они доступны на бэке — SLT-41/42, 404 для остальных). `editor`/`viewer` видят лишь ссылку
 * «открыть» — плюс метку своей роли, чтобы не путать shared-доску со своей.
 *
 * `aria-label` на кнопках включает название доски: экранный диктор в списке из десяти «Удалить»
 * иначе не скажет, какую именно. Иконки декоративны (`aria-hidden`) — смысл несёт label.
 */
export function BoardCard({ board, onDelete, onShare }: BoardCardProps): ReactElement {
  const isOwner = board.role === 'owner';

  return (
    <li className="flex items-center gap-2 rounded-xl border border-black/10 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <Link to={boardPath(board.id)} className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="block truncate font-medium text-[#272d36]">{board.title}</span>
          {!isOwner && (
            <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-[#272d36]/70">
              {ROLE_LABEL[board.role]}
            </span>
          )}
        </span>
        <time dateTime={board.updatedAt} className="text-xs text-[#272d36]/60">
          Изменено {formatUpdatedAt(board.updatedAt)}
        </time>
      </Link>
      {isOwner && (
        <>
          <button
            type="button"
            onClick={() => onShare(board)}
            aria-label={`Поделиться доской «${board.title}»`}
            className="shrink-0 rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium text-[#272d36] transition-colors hover:bg-black/5"
          >
            Поделиться
          </button>
          <button
            type="button"
            onClick={() => onDelete(board)}
            aria-label={`Удалить доску «${board.title}»`}
            className="shrink-0 rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium text-[#272d36] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
          >
            Удалить
          </button>
        </>
      )}
    </li>
  );
}
