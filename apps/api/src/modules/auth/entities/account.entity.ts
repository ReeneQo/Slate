import type { Prisma } from '@slate/database';

/**
 * Набор полей Account, который вообще покидает репозиторий. ИСТОЧНИК ИСТИНЫ — этот select
 * (см. докстринг SAFE_USER_SELECT — та же логика).
 *
 * Токены НЕ выбираются, потому что их нет в модели (SLT-50: не храним). `userId` в select есть
 * (в отличие от BOARD_MEMBER_SELECT, где он выводится из вложенного `user.id`) — здесь именно
 * userId и есть то единственное, ради чего резолв входа обращается к Account.
 */
export const ACCOUNT_SELECT = {
  id: true,
  provider: true,
  providerAccountId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.AccountSelect;

/** Account в том виде, в каком его видит сервис. */
export type AccountEntity = Prisma.AccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;
