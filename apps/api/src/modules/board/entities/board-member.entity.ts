import type { Prisma } from '@slate/database';

/**
 * Набор полей участника, который вообще покидает репозиторий. ИСТОЧНИК ИСТИНЫ — этот select, тип
 * ниже выводится из него (см. докстринг BOARD_SELECT — та же логика).
 *
 * `user` — вложенная выборка, а не отдельный запрос: список участников всегда нужен ВМЕСТЕ с их
 * профилем (email/имя для отображения), а не отдельно. Поля профиля — минимальные (id, email,
 * displayName), без `passwordHash`: это не `SAFE_USER_SELECT` (тот полнее — есть даты), а свой,
 * ещё более узкий срез, ровно тот, что уходит на фронт (см. toBoardMemberDto).
 *
 * `boardId`/`userId` в select НЕТ: `boardId` уже известен вызывающему (это параметр запроса),
 * `userId` есть внутри `user.id`. Тащить их дважды значит завести два способа получить одно и то
 * же значение.
 */
export const BOARD_MEMBER_SELECT = {
  id: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, email: true, displayName: true } },
} as const satisfies Prisma.BoardMemberSelect;

/** Участник доски в том виде, в каком его видит сервис. */
export type BoardMemberEntity = Prisma.BoardMemberGetPayload<{
  select: typeof BOARD_MEMBER_SELECT;
}>;
