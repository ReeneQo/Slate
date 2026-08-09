import type { Prisma } from '@slate/database';

/**
 * Область видимости ЗАПИСИ конкретного членства — управление шерингом owner-only (SLT-42,
 * решение 2), тот же образец, что `updateAccessible`/`deleteAccessible` доски (SLT-41): владение
 * проверяется прямо в `where`, а не отдельным запросом до записи, — иначе появилось бы окно между
 * «можно» и «пишем» (TOCTOU).
 *
 * `boardId_userId` — составной уникальный ключ (`@@unique([boardId, userId])`), `board: { ownerId }` —
 * фильтр по связи прямо в `WhereUniqueInput`, тот же приём, что `accessibleElementScope`
 * (element.access.ts) использует для `board: accessibleBoardScope(userId)`. Prisma поддерживает
 * такие «расширенные» unique-where и для update/delete, не только для чтения.
 *
 * Отдельная функция, а не инлайн в репозитории: «кто вправе управлять членством» — то же правило,
 * что у rename/delete доски (владелец и только он), и оно должно читаться в одном месте, а не
 * сравниваться `ownerId === callerId` по копии в каждом методе.
 */
export function ownerManagedMemberScope(
  boardId: string,
  memberUserId: string,
  ownerId: string,
): Prisma.BoardMemberWhereUniqueInput {
  return { boardId_userId: { boardId, userId: memberUserId }, board: { ownerId } };
}
