import type { ReactElement, ReactNode } from 'react';
import { BrowserRouter } from 'react-router';

import { useAuthBootstrap } from '@/features/auth';

/**
 * Запускает bootstrap auth (восстановление сессии + подключение onUnauthorized). Отдельный
 * компонент, потому что хук обязан жить внутри React-дерева.
 */
function AuthBootstrap({ children }: { children: ReactNode }): ReactElement {
  useAuthBootstrap();
  return <>{children}</>;
}

/**
 * Корневые провайдеры приложения: роутер (декларативный BrowserRouter) + bootstrap auth. Сюда
 * же лягут будущие провайдеры (react-query — SLT-26): порядок оборачивания живёт в одном месте.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <BrowserRouter>
      <AuthBootstrap>{children}</AuthBootstrap>
    </BrowserRouter>
  );
}
