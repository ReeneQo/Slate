import type { ReactElement } from 'react';

import { AppProviders } from './providers';
import { AppRoutes } from './routes';

/**
 * Корень приложения: провайдеры (роутер и будущие) оборачивают дерево роутов. Вся композиция
 * тонкая — конкретика живёт в app/providers и app/routes.
 */
export function App(): ReactElement {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
