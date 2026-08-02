import type { ReactElement } from 'react';

/**
 * Экран загрузки на время восстановления сессии (первый `/me`). Отдельное состояние гварда:
 * пока статус `loading`, ни приватный контент, ни форма логина показывать нельзя.
 */
export function AuthLoading(): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-[#f7f6f3] text-sm text-[#272d36]/70"
    >
      Загрузка…
    </div>
  );
}
