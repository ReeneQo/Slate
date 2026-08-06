import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useState } from 'react';
import { BrowserRouter } from 'react-router';

import { useAuthBootstrap } from '@/features/auth';

import { createQueryClient } from './queryClient';
import { useRealtimeConnection } from './useRealtimeConnection';

/**
 * Запускает bootstrap auth (восстановление сессии + подключение onUnauthorized). Отдельный
 * компонент, потому что хук обязан жить внутри React-дерева.
 */
function AuthBootstrap({ children }: { children: ReactNode }): ReactElement {
  useAuthBootstrap();
  return <>{children}</>;
}

/**
 * Подключает/рвёт realtime-сокет вслед за статусом auth (SLT-37). Отдельный компонент внутри
 * AuthBootstrap (не наоборот): читает уже восстановленный auth-стор, а не гоняется за тем, в
 * каком порядке сработают эффекты — оба хука подписаны на один и тот же стор, порядок вложения
 * функционально не важен, но так он читается как «сначала auth, затем то, что от него зависит».
 */
function RealtimeBootstrap({ children }: { children: ReactNode }): ReactElement {
  useRealtimeConnection();
  return <>{children}</>;
}

/**
 * Корневые провайдеры приложения: react-query → роутер → bootstrap auth → bootstrap realtime.
 * Порядок оборачивания живёт в одном месте.
 *
 * QueryClient держим в `useState` (ленивый инициализатор), а не модульной константой: инстанс
 * рождается ВНУТРИ дерева и один на всё время жизни приложения. Модульный синглтон в SSR/тестах
 * протёк бы между рендерами и делил кэш между независимыми деревьями; здесь SPA, но привычка
 * дешёвая и снимает класс багов. `createQueryClient` вызовется ровно раз — не на каждый рендер.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthBootstrap>
          <RealtimeBootstrap>{children}</RealtimeBootstrap>
        </AuthBootstrap>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
