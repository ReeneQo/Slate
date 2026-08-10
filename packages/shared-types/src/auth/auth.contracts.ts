import { z } from 'zod';

import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './auth.constants.js';

/**
 * Контракты auth-эндпоинтов (login/register) — по тому же паттерну, что board/element (SLT-23).
 *
 * Схема — источник и рантайм-проверок, и ТИПА (через `z.infer`): описать форму дважды (типом и
 * валидатором) значит завести два места, которые обязаны совпадать, но проверить это некому.
 *
 * Разделение труда между слоями сознательное. Фронт валидирует этими схемами по-настоящему —
 * react-hook-form отдаёт им тело формы. Бэк остаётся на class-validator (декораторы + Nest
 * ValidationPipe), а схемы использует как ТИП: DTO объявлены через `implements`, поэтому
 * расхождение полей роняет сборку бэка, а не всплывает 400-ым у пользователя. Границы длины оба
 * берут из общих констант, так что `@MinLength`/`@MaxLength` и zod разойтись не могут.
 *
 * `passwordRepeat` здесь НЕТ намеренно: совпадение двух полей — свойство ФОРМЫ, а не запроса.
 * Сервер получает один пароль и не может знать, что имел в виду пользователь. Проверяет это
 * фронт локальным refine (SLT-25, features/auth), там же, где оба поля и существуют.
 */

/** Сообщения нейтральные и на бэке одинаковые для login/register — не отдаём оракул для перебора. */
const emailSchema = z.email('Некорректный email');

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Пароль не короче ${PASSWORD_MIN_LENGTH} символов`)
  .max(PASSWORD_MAX_LENGTH, `Пароль не длиннее ${PASSWORD_MAX_LENGTH} символов`);

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Имя не может быть пустым')
  .max(DISPLAY_NAME_MAX_LENGTH, `Имя не длиннее ${DISPLAY_NAME_MAX_LENGTH} символов`);

/**
 * Вход `POST /auth/login`.
 *
 * `z.object`, а не `strictObject`: лишние ключи отбрасываются молча — ровно как ведёт себя
 * `ValidationPipe({ whitelist: true })` на бэке. Схема обязана описывать ТО ЖЕ поведение, иначе
 * клиент считал бы запрос невалидным там, где сервер спокойно его принимает.
 */
export const loginInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginInputSchema>;

/** Вход `POST /auth/register`. Порядок полей совпадает с RegisterDto бэка. */
export const registerInputSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerInputSchema>;

/**
 * Ответ login/register — «кто только что вошёл». Минимальный набор: `hasPassword` тут был бы
 * константным `true`, а `createdAt` — это профиль, а не сессия (см. AuthUserDto бэка).
 *
 * `strictObject`: лишнее поле в ответе — это не «немного больше данных», а разъехавшийся
 * контракт (например, утёкший `passwordHash`). Response-схемы к DTO через `implements` НЕ
 * привязываются (на проводе `createdAt` — строка, в памяти сервера `Date`); их сверка — парсинг
 * реальных тел ответов в e2e (SLT-23, решение 2).
 */
export const authUserResponseSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
});

export type AuthUserResponse = z.infer<typeof authUserResponseSchema>;

/**
 * Ответ `GET /auth/me` — «кто я по этой куке». Форма НА ПРОВОДЕ: `createdAt` — ISO-строка
 * (`z.iso.datetime()`), потому что JSON дат не знает, хотя в UserResponseDto бэка это `Date`.
 * Это каноничная форма пользователя, которой фронт заполняет auth-стор (SLT-25).
 */
export const userResponseSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  hasPassword: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
