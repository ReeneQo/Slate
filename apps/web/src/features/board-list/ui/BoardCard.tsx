import type { ReactElement } from 'react';
import { Link } from 'react-router';

import type { Board } from '@/entities/board';
import { boardPath } from '@/shared/config';

import { formatUpdatedAt } from '../lib/formatUpdatedAt';

interface BoardCardProps {
  board: Board;
  onDelete: (board: Board) => void;
}

/**
 * Карточка доски в списке. Заголовок — ссылка на холст доски (SLT-27, пока заглушка): переход
 * через `boardPath`, а не ручная склейка URL. Кнопка удаления вынесена ИЗ ссылки (соседний
 * элемент, не вложенный): интерактив внутри интерактива — и невалидный HTML, и ловушка для
 * клика/фокуса.
 *
 * `aria-label` на кнопке включает название доски: экранный диктор в списке из десяти «Удалить»
 * иначе не скажет, какую именно. Иконка декоративна (`aria-hidden`) — смысл несёт label.
 */
export function BoardCard({ board, onDelete }: BoardCardProps): ReactElement {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-black/10 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <Link to={boardPath(board.id)} className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[#272d36]">{board.title}</span>
        <time dateTime={board.updatedAt} className="text-xs text-[#272d36]/60">
          Изменено {formatUpdatedAt(board.updatedAt)}
        </time>
      </Link>
      <button
        type="button"
        onClick={() => onDelete(board)}
        aria-label={`Удалить доску «${board.title}»`}
        className="shrink-0 rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium text-[#272d36] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
      >
        Удалить
      </button>
    </li>
  );
}
