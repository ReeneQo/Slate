import { z } from 'zod';

import { authUserResponseSchema } from '../auth/auth.contracts.js';
import { BOARD_TITLE_MAX_LENGTH } from './board.constants.js';
import { boardAccessRoleSchema, boardMemberRoleSchema } from './board-member.types.js';

/**
 * Контракты board-эндпоинтов.
 *
 * Схема — источник и рантайм-проверки, и ТИПА (через `z.infer`): описать форму дважды (типом и
 * валидатором) значит завести два места, которые обязаны совпадать, но проверить это некому.
 *
 * Разделение труда между слоями сознательное. Фронт валидирует этими схемами по-настоящему —
 * react-hook-form отдаёт им тело формы. Бэк остаётся на class-validator (декораторы + Nest
 * ValidationPipe), а схемы использует как ТИП: DTO объявлены через `implements`, поэтому
 * расхождение полей роняет сборку бэка, а не всплывает 400-ым у пользователя.
 */

/** Название доски. Правила ровно те же, что у декораторов CreateBoardDto/UpdateBoardDto. */
const boardTitleSchema = z
  .string()
  .trim()
  .min(1, 'Название не может быть пустым')
  .max(BOARD_TITLE_MAX_LENGTH, `Название не длиннее ${BOARD_TITLE_MAX_LENGTH} символов`);

/**
 * Вход `POST /boards`.
 *
 * `ownerId` здесь нет и быть не может: владелец берётся из сессии. Поле во входе означало бы
 * «создай доску от имени любого пользователя по его id».
 *
 * `title` опционален — в схеме БД у него `@default("Untitled")`. Дефолт держит Postgres, а не
 * сервер и не клиент: иначе значение существует в трёх местах и однажды разойдётся.
 *
 * `z.object`, а не `strictObject`: лишние ключи отбрасываются молча — ровно так же ведёт себя
 * `ValidationPipe({ whitelist: true })` на бэке. Схема обязана описывать ТО ЖЕ поведение, иначе
 * клиент считал бы запрос невалидным там, где сервер спокойно его принимает.
 */
export const createBoardSchema = z.object({
  title: boardTitleSchema.optional(),
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;

/**
 * Вход `PATCH /boards/:id`.
 *
 * `title` ОБЯЗАТЕЛЕН, хотя метод PATCH формально допускает частичное обновление: изменяемое
 * поле у доски сейчас ровно одно, и запрос без него ничего не меняет, зато инкрементит version
 * и обновляет updatedAt — то есть тихо портит данные вместо честного отказа.
 */
export const updateBoardSchema = z.object({
  title: boardTitleSchema,
});

export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;

/**
 * Доска в ответе — форма НА ПРОВОДЕ, а не в памяти сервера.
 *
 * Отсюда `z.iso.datetime()` вместо `z.date()`: в BoardDto бэкенда это `Date`, но до клиента
 * доезжает строка — JSON дат не знает. Один тип на обе стороны здесь физически невозможен,
 * поэтому выходы, в отличие от входов, к DTO через `implements` НЕ привязываются. Их сверка —
 * рантайм-парсинг настоящих тел ответов в e2e: `boardResponseSchema.parse(response.body)`
 * падает, если сервер отдал не то, что обещает контракт.
 *
 * `strictObject` именно здесь принципиален: он ловит ЛИШНЕЕ поле в ответе. Утечка `ownerId`
 * или `version` — это не «немного больше данных», а разъехавшийся контракт, который клиент
 * начнёт использовать раньше, чем кто-нибудь заметит.
 */
export const boardResponseSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type BoardResponse = z.infer<typeof boardResponseSchema>;

/**
 * Элемент `GET /boards` (SLT-42): та же форма, что `boardResponseSchema`, плюс `role` — уровень
 * ДОСТУПА текущего юзера к этой доске (`owner` | `editor` | `viewer`).
 *
 * Список — теперь owned ∪ shared (SLT-42, решение 3), и без роли клиент не смог бы отличить
 * «моя доска» от «расшаренная со мной» и не знал бы, показывать ли элементы управления, доступные
 * только owner'у (рейм-гейт на UI — SLT-43, но контракт для него нужен уже здесь). Отдельная схема,
 * а не поле на `boardResponseSchema` целиком: `GET /boards/:id` (одиночная доска) роли не несёт —
 * там всегда «моя» в смысле открытого доступа, а различать owner/editor/viewer там не для чего.
 */
export const boardListItemResponseSchema = boardResponseSchema.extend({
  role: boardAccessRoleSchema,
});

export type BoardListItemResponse = z.infer<typeof boardListItemResponseSchema>;

/** Список досок: `GET /boards`. Одно определение на клиента и на тесты — как и у элементов. */
export const boardListResponseSchema = z.array(boardListItemResponseSchema);

/**
 * Тип списка, выведенный из схемы (`z.infer`) — как и у остальных контрактов пакета. Клиент
 * (SLT-26) типизирует им ответ `getBoards`, тесты сверяют им же реальное тело: одно определение
 * не даёт типу и рантайм-проверке разойтись.
 */
export type BoardListResponse = z.infer<typeof boardListResponseSchema>;

/**
 * Контракты шеринга (SLT-42): `POST/PATCH/DELETE/GET /boards/:id/members`.
 *
 * Email — резолв приглашаемого ОТДЕЛЬНЫМ полем, не «identifier» union. Сегодня приглашение только
 * по email; когда появится username-шеринг (реестр), добавится вторая ветка резолва на бэке
 * (`resolveInvitee`), а этот контракт получит своё поле `username?` точечно — без спекулятивного
 * `identifier: { type, value }` уже сейчас (YAGNI, решение 1 тикета).
 */
const inviteEmailSchema = z.email('Некорректный email');

/** Вход `POST /boards/:id/members` — пригласить существующего пользователя по email. */
export const inviteMemberSchema = z.object({
  email: inviteEmailSchema,
  role: boardMemberRoleSchema,
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** Вход `PATCH /boards/:id/members/:userId` — сменить роль участника. */
export const updateMemberRoleSchema = z.object({
  role: boardMemberRoleSchema,
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Участник в ответе — форма НА ПРОВОДЕ. `user` — тот же минимальный профиль, что в ответе
 * login/register (`authUserResponseSchema`: id/email/displayName, без `hasPassword`/`createdAt`
 * профиля): списку участников чужой `hasPassword` не нужен и не должен утекать.
 *
 * `id` здесь — id СТРОКИ `BoardMember`, не пользователя (тот — `user.id`). Управление (PATCH/DELETE)
 * при этом адресуется по `user.id` в URL (`:userId`), а не по этому `id`: с точки зрения клиента
 * участник — это пользователь на доске, а не запись в таблице членства.
 */
export const boardMemberResponseSchema = z.strictObject({
  id: z.uuid(),
  role: boardMemberRoleSchema,
  createdAt: z.iso.datetime(),
  user: authUserResponseSchema,
});

export type BoardMemberResponse = z.infer<typeof boardMemberResponseSchema>;

/** Список участников: `GET /boards/:id/members`. */
export const boardMemberListResponseSchema = z.array(boardMemberResponseSchema);

export type BoardMemberListResponse = z.infer<typeof boardMemberListResponseSchema>;
