import { z } from 'zod';

/**
 * Роли участников доски и уровни доступа — СВОЙ перечень, а не реэкспорт enum'а из @slate/database
 * (та же причина, что у `elementTypeSchema`: контракт не должен тащить за собой Prisma в браузер).
 *
 * Два разных перечня, а не один:
 *
 * - `boardMemberRoleSchema` — роль СТРОКИ `BoardMember` (`editor` | `viewer`). Ровно то, что можно
 *   назначить приглашением или сменить PATCH'ем: owner в эту таблицу не попадает (SLT-42, решение 4),
 *   так что «пригласить владельцем» этот тип запрещает уже на границе схемы.
 * - `boardAccessRoleSchema` — уровень ДОСТУПА текущего юзера к доске (`owner` | `editor` | `viewer`),
 *   ровно `AccessLevel` бэка (board.access.ts) без `null` (доска в списке уже доступна по построению
 *   запроса). Нужен `GET /boards`: элемент списка обязан нести роль, которой смотрит именно этот
 *   пользователь, — а она может быть `owner`, чего `BoardMemberRole` не выражает.
 */
export const boardMemberRoleSchema = z.enum(['editor', 'viewer']);

export type BoardMemberRole = z.infer<typeof boardMemberRoleSchema>;

export const boardAccessRoleSchema = z.enum(['owner', 'editor', 'viewer']);

export type BoardAccessRole = z.infer<typeof boardAccessRoleSchema>;
