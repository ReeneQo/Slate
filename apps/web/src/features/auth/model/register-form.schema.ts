import { registerInputSchema } from '@slate/shared-types';
import { z } from 'zod';

/**
 * Схема ФОРМЫ регистрации = контракт бэка (registerInputSchema) + локальное поле passwordRepeat.
 *
 * passwordRepeat живёт ТОЛЬКО здесь и в контракт (@slate/shared-types) не входит: совпадение
 * двух полей — свойство формы, а не запроса; сервер получает один пароль. Перед сабмитом поле
 * отбрасывается (в контракт уходит RegisterInput без него).
 *
 * `.refine` вешает ошибку на `passwordRepeat` (path), поэтому rhf покажет её под нужным полем,
 * а не как ошибку всей формы.
 */
export const registerFormSchema = registerInputSchema
  .extend({ passwordRepeat: z.string() })
  .refine((values) => values.password === values.passwordRepeat, {
    message: 'Пароли не совпадают',
    path: ['passwordRepeat'],
  });

export type RegisterFormValues = z.infer<typeof registerFormSchema>;
