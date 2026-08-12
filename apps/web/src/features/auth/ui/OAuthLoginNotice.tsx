import { type ReactElement, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { mapOAuthLoginErrorCode } from '../lib/mapOAuthCode';

/**
 * Баннер результата OAuth-входа на `/login` (`?error=...`, SLT-52). Тостов в проекте нет
 * (Р0.2) — фолбэк на инлайн-`role="alert"`, персистентный по умолчанию (без авто-таймера):
 * закрывается только кнопкой, этого достаточно для «читаемого дольше 3с» требования, особенно
 * важного для `emailConflict` (юзер должен успеть прочитать «войдите паролем»).
 *
 * Код читаем ОДИН раз при монтировании (`useState` lazy init) и сразу чистим `?error=` из URL
 * (`replace`, чтобы рефреш формы не «повторял» баннер) — но локальное состояние `code` держит
 * баннер видимым до явного закрытия юзером, независимо от URL.
 */
export function OAuthLoginNotice(): ReactElement | null {
  const [searchParams, setSearchParams] = useSearchParams();
  const [code] = useState(() => searchParams.get('error'));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!code) return;
    setSearchParams(
      (params) => {
        params.delete('error');
        return params;
      },
      { replace: true },
    );
    // Снимок URL при монтировании — не реактивная синхронизация, поэтому searchParams/
    // setSearchParams намеренно вне зависимостей.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!code || dismissed) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      <p>{mapOAuthLoginErrorCode(code)}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Закрыть"
        className="shrink-0 text-red-700/60 hover:text-red-700"
      >
        ×
      </button>
    </div>
  );
}
