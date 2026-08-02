/**
 * Публичная поверхность фичи auth. Внешние слои (app) импортируют `@/features/auth`, а не
 * внутренние файлы — раскладка (api/model/ui/lib) остаётся деталью реализации.
 */
export { useAuthStore } from './model/auth.store';
export { signOut } from './model/session';
export { useAuthBootstrap } from './model/useAuthBootstrap';
export { LoginForm, RegisterForm, RequireAuth, RequireGuest } from './ui';
