import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';

import { ROUTES } from '@/shared/config';

import { mapRegisterError } from '../lib/mapAuthError';
import { registerFormSchema, type RegisterFormValues } from '../model/register-form.schema';
import { signUp } from '../model/session';
import { AuthCard } from './AuthCard';
import { FormField } from './FormField';
import { OAuthGithubButton } from './OAuthGithubButton';

/**
 * Форма регистрации. Схема — контракт бэка + локальный `passwordRepeat` (refine на совпадение).
 * Перед отправкой `passwordRepeat` отбрасывается: в контракт (RegisterInput) уходят только
 * email/displayName/password. Навигация — через гвард (как в LoginForm). 409 → «email занят».
 */
export function RegisterForm(): ReactElement {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { email: '', displayName: '', password: '', passwordRepeat: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signUp({
        email: values.email,
        displayName: values.displayName,
        password: values.password,
      });
    } catch (error) {
      setError('root', { message: mapRegisterError(error) });
    }
  });

  return (
    <AuthCard
      title="Регистрация"
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link to={ROUTES.login} className="text-[#c2613d] hover:underline">
            Вход
          </Link>
        </>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          registration={register('email')}
          error={errors.email}
        />
        <FormField
          label="Имя"
          type="text"
          autoComplete="name"
          registration={register('displayName')}
          error={errors.displayName}
        />
        <FormField
          label="Пароль"
          type="password"
          autoComplete="new-password"
          registration={register('password')}
          error={errors.password}
        />
        <FormField
          label="Повторите пароль"
          type="password"
          autoComplete="new-password"
          registration={register('passwordRepeat')}
          error={errors.passwordRepeat}
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
          {isSubmitting ? 'Регистрация…' : 'Зарегистрироваться'}
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
