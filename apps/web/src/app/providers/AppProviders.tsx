import type { ReactElement, ReactNode } from 'react';
import { BrowserRouter } from 'react-router';

/**
 * Корневые провайдеры приложения. Пока это только роутер (декларативный BrowserRouter, не
 * data-API-роутер), но сюда же лягут будущие провайдеры (react-query — SLT-26): App остаётся
 * тонким, а порядок оборачивания живёт в одном месте, а не расползается по дереву.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return <BrowserRouter>{children}</BrowserRouter>;
}
