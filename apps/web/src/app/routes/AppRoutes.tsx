import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';

import { LoginForm, RegisterForm, RequireAuth, RequireGuest } from '@/features/auth';
import { ROUTES } from '@/shared/config';

import { BoardsStub } from './BoardsStub';

/**
 * Дерево роутов — декларативный react-router (Routes/Route), НЕ data-API-роутер. Пути из общего
 * реестра ROUTES.
 *
 * Защита — по СТАТУСУ auth-стора (гварды), а не императивным navigate: приватная зона под
 * RequireAuth (аноним → login), а login/register под RequireGuest (залогиненный → home).
 * Приватная зона пока заглушка (BoardsStub); список досок — SLT-26.
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route
        path={ROUTES.home}
        element={
          <RequireAuth>
            <BoardsStub />
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
