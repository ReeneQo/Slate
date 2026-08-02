import type { ReactElement, ReactNode } from 'react';
import { Navigate } from 'react-router';

import { ROUTES } from '@/shared/config';

import { useAuthStore } from '../model/auth.store';
import { AuthLoading } from './AuthLoading';

/**
 * Гвард гостевых роутов (login/register).
 *  - loading → загрузка (не мигаем формой залогиненному до ответа `/me`);
 *  - authenticated → редирект на home (уже вошёл, форма не нужна);
 *  - anonymous → children.
 */
export function RequireGuest({ children }: { children: ReactNode }): ReactElement {
  const status = useAuthStore((state) => state.status);

  if (status === 'loading') return <AuthLoading />;
  if (status === 'authenticated') return <Navigate to={ROUTES.home} replace />;
  return <>{children}</>;
}
