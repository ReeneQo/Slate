import type { ReactElement } from 'react';

import { useOAuthConnect } from '../model/useOAuthConnect';
import { GithubIcon } from './GithubIcon';

/**
 * Кнопка «Войти через GitHub» — ОДИН компонент на login и register (не дублируем). Дёргает
 * `useOAuthConnect`: успех уводит редиректом на GitHub (см. хук), поэтому у кнопки нет своего
 * успешного состояния — только pending (запрос за URL) и error (запрос не дошёл до редиректа).
 *
 * Стиль — вторичная кнопка (border, без заливки), как «Выйти» в шапке дашборда: OAuth здесь
 * альтернативный путь входа, а не основной CTA формы (тот остаётся primary-заливкой).
 */
export function OAuthGithubButton(): ReactElement {
  const connect = useOAuthConnect();

  return (
    <div>
      <button
        type="button"
        onClick={() => connect.mutate()}
        disabled={connect.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium text-[#272d36] transition-colors hover:bg-black/5 disabled:opacity-60"
      >
        <GithubIcon className="h-4 w-4" />
        {connect.isPending ? 'Переход на GitHub…' : 'Войти через GitHub'}
      </button>
      {connect.isError && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          Не удалось начать вход через GitHub. Попробуйте ещё раз.
        </p>
      )}
    </div>
  );
}
