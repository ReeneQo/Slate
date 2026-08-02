import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';

import { ROUTES } from '@/shared/config';
import { CanvasStage } from '@/widgets/canvas';

/**
 * Дерево роутов приложения — декларативный react-router (Routes/Route), НЕ data-API-роутер.
 * Пути берутся из общего реестра ROUTES, а не хардкодятся здесь: один источник правды на весь
 * фронт. Auth-роуты (login/register) и защита приватной зоны подключаются в SLT-25 (features/auth).
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path={ROUTES.home} element={<CanvasStage />} />
    </Routes>
  );
}
