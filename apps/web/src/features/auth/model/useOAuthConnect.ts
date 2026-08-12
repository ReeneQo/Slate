import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { getOAuthConnectUrl, type OAuthConnectResponse } from '../api';

/**
 * Мутация начала OAuth-входа (SLT-52). Успех — не JSON-результат для рендера, а редирект: кладём
 * `window.location.href = url` прямо в `onSuccess` и уходим со страницы. Ошибку (сеть/5xx до
 * ухода на GitHub) кнопка показывает через `isError` — дальше решать нечего, повторной мутации
 * достаточно.
 */
export function useOAuthConnect(): UseMutationResult<OAuthConnectResponse, unknown, void> {
  return useMutation({
    mutationFn: () => getOAuthConnectUrl(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}
