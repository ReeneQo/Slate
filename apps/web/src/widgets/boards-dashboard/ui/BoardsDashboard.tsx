import { type ReactElement, useState } from 'react';

import type { BoardListItem } from '@/entities/board';
import { OAuthLinkNotice, signOut, useAuthStore } from '@/features/auth';
import { BoardList } from '@/features/board-list';
import { ShareDialog } from '@/features/board-sharing';

/**
 * Композиция экрана дашборда: шапка (пользователь + выход) над списком досок. Живёт в widgets, а
 * НЕ в фиче: связывает ТРИ фичи — auth (выход), board-list (список) и board-sharing (диалог,
 * SLT-43). По границам FSD фича не может импортировать другую фичу, поэтому их «склейка» — задача
 * виджета. Виджет тонкий: компоновка и layout, без бизнес-логики.
 *
 * `boardToShare` — ЛОКАЛЬНОЕ состояние виджета (какую доску шерим), тот же приём, что у
 * `boardToDelete` внутри `BoardList`: диалог шеринга открывается только владельцем карточки
 * (`BoardCard` зовёт `onShare` лишь для `role === 'owner'`, см. board-list), так что роль в
 * `ShareDialog` здесь всегда `'owner'` — жёстко, а не из `board.role` (та же гарантия, просто
 * явно, без лишнего чтения поля).
 */
export function BoardsDashboard(): ReactElement {
  const user = useAuthStore((state) => state.user);
  const [boardToShare, setBoardToShare] = useState<BoardListItem | null>(null);

  return (
    <div className="min-h-screen bg-[#f7f6f3] text-[#272d36]">
      <header className="flex items-center justify-between border-b border-black/10 bg-white px-6 py-3">
        <span className="text-sm text-[#272d36]/70">{user?.displayName ?? 'Пользователь'}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5"
        >
          Выйти
        </button>
      </header>
      <OAuthLinkNotice />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <BoardList onShare={setBoardToShare} />
      </main>

      {boardToShare && (
        <ShareDialog
          boardId={boardToShare.id}
          accessRole="owner"
          open
          onClose={() => setBoardToShare(null)}
        />
      )}
    </div>
  );
}
