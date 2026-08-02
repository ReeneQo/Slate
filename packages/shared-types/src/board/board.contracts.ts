import { z } from 'zod';

import { BOARD_TITLE_MAX_LENGTH } from './board.constants.js';

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

/** Список досок: `GET /boards`. Одно определение на клиента и на тесты — как и у элементов. */
export const boardListResponseSchema = z.array(boardResponseSchema);
