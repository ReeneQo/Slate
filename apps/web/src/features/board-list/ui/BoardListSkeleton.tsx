import type { ReactElement } from 'react';

/**
 * Скелетон списка на время первой загрузки. Заглушки повторяют геометрию карточек, чтобы контент
 * не «прыгал» при подмене. `aria-hidden` + внешний `role="status"` (в BoardList): диктору незачем
 * зачитывать пустые плейсхолдеры — он услышит текстовое «Загрузка».
 */
export function BoardListSkeleton(): ReactElement {
  return (
    <ul aria-hidden className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <li
          key={index}
          className="flex items-center gap-2 rounded-xl border border-black/10 bg-white p-4"
        >
          <div className="flex-1">
            <div className="h-4 w-1/3 animate-pulse rounded bg-black/10" />
            <div className="mt-2 h-3 w-1/4 animate-pulse rounded bg-black/5" />
          </div>
          <div className="h-8 w-20 animate-pulse rounded-lg bg-black/5" />
        </li>
      ))}
    </ul>
  );
}
