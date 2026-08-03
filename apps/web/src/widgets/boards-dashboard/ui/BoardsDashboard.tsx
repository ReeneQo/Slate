import type { ReactElement } from 'react';

import { signOut, useAuthStore } from '@/features/auth';
import { BoardList } from '@/features/board-list';

/**
 * Композиция экрана дашборда: шапка (пользователь + выход) над списком досок. Живёт в widgets, а
 * НЕ в фиче: связывает ДВЕ фичи — auth (выход) и board-list (список). По границам FSD фича не
 * может импортировать другую фичу, поэтому их «склейка» — задача виджета. Виджет тонкий:
 * компоновка и layout, без бизнес-логики.
 */
export function BoardsDashboard(): ReactElement {
  const user = useAuthStore((state) => state.user);

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
      <main className="mx-auto max-w-2xl px-6 py-8">
        <BoardList />
      </main>
    </div>
  );
}
