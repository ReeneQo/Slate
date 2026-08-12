import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginInputSchema } from '@slate/shared-types';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';

import { ROUTES } from '@/shared/config';

import { mapLoginError } from '../lib/mapAuthError';
import { signIn } from '../model/session';
import { AuthCard } from './AuthCard';
import { FormField } from './FormField';
import { OAuthGithubButton } from './OAuthGithubButton';
import { OAuthLoginNotice } from './OAuthLoginNotice';

/**
 * Форма логина: react-hook-form + zodResolver со схемой из контракта (@slate/shared-types) —
 * та же схема, что валидирует бэк, поэтому клиентская проверка не разойдётся с серверной.
 *
 * После успеха НЕ навигируем императивно: signIn переводит стор в authenticated, и гвард
 * RequireGuest сам уводит с /login на home. Ошибку бэка (401/429) кладём в `root` и показываем.
 */
export function LoginForm(): ReactElement {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signIn(values);
    } catch (error) {
      setError('root', { message: mapLoginError(error) });
    }
  });

  return (
    <AuthCard
      title="Вход"
      footer={
        <>
          Нет аккаунта?{' '}
          <Link to={ROUTES.register} className="text-[#c2613d] hover:underline">
            Регистрация
          </Link>
        </>
      }
    >
      <OAuthLoginNotice />
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          registration={register('email')}
          error={errors.email}
        />
        <FormField
          label="Пароль"
          type="password"
          autoComplete="current-password"
          registration={register('password')}
          error={errors.password}
        />
        {errors.root && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {errors.root.message}
          </p>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-[#c2613d] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#a94f30] disabled:opacity-60"
        >
          {isSubmitting ? 'Вход…' : 'Войти'}
        </button>
      </form>
      <div className="my-4 flex items-center gap-3 text-xs text-[#272d36]/40">
        <span className="h-px flex-1 bg-black/10" />
        или
        <span className="h-px flex-1 bg-black/10" />
      </div>
      <OAuthGithubButton />
    </AuthCard>
  );
}
