import type { Prisma } from '@slate/database';

/**
 * Набор полей «безопасного» пользователя. ИСТОЧНИК ИСТИНЫ — этот select, а не тип:
 * тип ниже выводится из него, поэтому рассинхрон физически невозможен.
 *
 * Ключевое: passwordHash отсутствует в SELECT, то есть его нет в РАНТАЙМ-объекте.
 * Это не то же самое, что `Omit<User, 'passwordHash'>`: при выборке без select Prisma
 * тянет всю строку, хеш реально лежит в объекте, гуляет по памяти и попадёт в любой
 * `JSON.stringify` — в лог, в ответ, в трассировку ошибки, — а `Omit` лишь прячет его
 * от компилятора. Тип, расходящийся с рантаймом, — это не защита, а её иллюзия.
 *
 * `as const` обязателен: без него `id: true` выводится как `boolean`, и Prisma не
 * сможет вывести форму результата. `satisfies` при этом проверяет, что все ключи
 * реально существуют в модели — опечатка в имени поля не доживёт до рантайма.
 */
export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

/**
 * Выборка С хешем — ТОЛЬКО для аутентификации (проверка пароля в SLT-16).
 * Строится из безопасной, чтобы поля не разъезжались при изменении модели.
 */
export const USER_WITH_HASH_SELECT = {
  ...SAFE_USER_SELECT,
  passwordHash: true,
} as const satisfies Prisma.UserSelect;

/** Пользователь без хеша пароля — всё, что покидает репозиторий в обычных сценариях. */
export type SafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

/**
 * Пользователь с хешем. `passwordHash` — `string | null`: колонка nullable, потому что
 * под OAuth-регистрацию (блок 2) заведён пользователь без пароля вообще.
 */
export type UserWithHash = Prisma.UserGetPayload<{ select: typeof USER_WITH_HASH_SELECT }>;
