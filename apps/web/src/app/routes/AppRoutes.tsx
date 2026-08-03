import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';

import { LoginForm, RegisterForm, RequireAuth, RequireGuest } from '@/features/auth';
import { ROUTES } from '@/shared/config';
import { BoardsDashboard } from '@/widgets/boards-dashboard';

import { BoardCanvasRoute } from './BoardCanvasRoute';

/**
 * Дерево роутов — декларативный react-router (Routes/Route), НЕ data-API-роутер. Пути из общего
 * реестра ROUTES.
 *
 * Защита — по СТАТУСУ auth-стора (гварды), а не императивным navigate: приватная зона под
 * RequireAuth (аноним → login), а login/register под RequireGuest (залогиненный → home).
 * Приватные роуты: home — дашборд досок (SLT-26); `/boards/:id` — холст с синхронизацией (SLT-27).
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route
        path={ROUTES.home}
        element={
          <RequireAuth>
            <BoardsDashboard />
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.board}
        element={
          <RequireAuth>
            <BoardCanvasRoute />
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.login}
        element={
          <RequireGuest>
            <LoginForm />
          </RequireGuest>
        }
      />
      <Route
        path={ROUTES.register}
        element={
          <RequireGuest>
            <RegisterForm />
          </RequireGuest>
        }
      />
    </Routes>
  );
}
