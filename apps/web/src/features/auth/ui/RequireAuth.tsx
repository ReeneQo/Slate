import type { ReactElement, ReactNode } from 'react';
import { Navigate } from 'react-router';

import { ROUTES } from '@/shared/config';

import { useAuthStore } from '../model/auth.store';
import { AuthLoading } from './AuthLoading';

/**
 * Гвард приватной зоны. Реагирует на СТАТУС стора, а не на навигацию — поэтому onUnauthorized
 * может просто сбросить стор без императивного navigate: смена статуса на anonymous сама
 * приводит сюда и выталкивает на login.
 *
 *  - loading → загрузка (решение о доступе откладываем до ответа `/me`);
 *  - anonymous → редирект на login (`replace`: приватный URL не оседает в истории);
 *  - authenticated → children.
 */
export function RequireAuth({ children }: { children: ReactNode }): ReactElement {
  const status = useAuthStore((state) => state.status);

  if (status === 'loading') return <AuthLoading />;
  if (status === 'anonymous') return <Navigate to={ROUTES.login} replace />;
  return <>{children}</>;
}
