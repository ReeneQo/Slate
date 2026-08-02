import type { ReactElement } from 'react';

import { signOut, useAuthStore } from '@/features/auth';

/**
 * Заглушка приватной зоны. Список досок — SLT-26; здесь пока приветствие и выход, чтобы вручную
 * проверить восстановление сессии и logout (DoD SLT-25). Живёт в app/routes: это временный
 * плейсхолдер уровня композиции, а не доменная фича.
 */
export function BoardsStub(): ReactElement {
  const user = useAuthStore((state) => state.user);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f7f6f3] text-[#272d36]">
      <h1 className="text-xl font-semibold">Привет, {user?.displayName ?? 'пользователь'}!</h1>
      <p className="text-sm text-[#272d36]/70">Доски появятся в SLT-26.</p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5"
      >
        Выйти
      </button>
    </main>
  );
}
