import { type ReactElement, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { mapOAuthLinkErrorCode, OAUTH_LINK_SUCCESS_MESSAGE } from '../lib/mapOAuthCode';

type OAuthLinkResult = { kind: 'success' } | { kind: 'error'; code: string };

function readResult(searchParams: URLSearchParams): OAuthLinkResult | null {
  if (searchParams.get('linked') === 'github') return { kind: 'success' };
  const code = searchParams.get('error');
  return code ? { kind: 'error', code } : null;
}

/**
 * Баннер результата привязки GitHub на `/` (`?linked=github` | `?error=...`, SLT-56). Часть
 * "ЧАСТЬ A" (обязательна независимо от того, что UI привязки/отвязки в этой задаче не строится,
 * см. отчёт Р0.1) — редирект бэк уже шлёт сюда, и его надо обработать, даже без кнопки «Привязать»
 * в интерфейсе (переход возможен, например, повторным заходом на сохранённый link-URL).
 *
 * Тот же приём, что у `OAuthLoginNotice`: код читаем один раз при монтировании, сразу чистим URL
 * (`replace`), но локально держим баннер видимым до закрытия юзером.
 */
export function OAuthLinkNotice(): ReactElement | null {
  const [searchParams, setSearchParams] = useSearchParams();
  const [result] = useState(() => readResult(searchParams));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!result) return;
    setSearchParams(
      (params) => {
        params.delete('linked');
        params.delete('error');
        return params;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result || dismissed) return null;

  const isSuccess = result.kind === 'success';
  const message = isSuccess ? OAUTH_LINK_SUCCESS_MESSAGE : mapOAuthLinkErrorCode(result.code);

  return (
    <div
      role="alert"
      className={
        'mx-6 mt-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ' +
        (isSuccess
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-red-200 bg-red-50 text-red-700')
      }
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Закрыть"
        className={
          'shrink-0 hover:opacity-100 ' + (isSuccess ? 'text-green-700/60' : 'text-red-700/60')
        }
      >
        ×
      </button>
    </div>
  );
}
