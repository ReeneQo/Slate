import {
  type PatchElementInput,
  patchElementSchema,
  type UpsertElementInput,
} from '@slate/shared-types';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import { type ElementDto, toElementDto } from '../element/dto/element.dto';
import type { ElementEntity } from '../element/entities/element.entity';

/**
 * Типы транспорта realtime. Фундамент этапа 3 (SLT-32) — соединение и его аутентификация,
 * членство в комнате доски (SLT-33), Redis-broadcast (SLT-34) — плюс первая содержательная
 * фича поверх них: presence, реестр «кто онлайн» (SLT-35, 3.2). Курсоры и синхронизация
 * элементов (3.3) наполнят карты дальше.
 *
 * `InterServerEvents` по-прежнему `Record<string, never>`, а НЕ пустым интерфейсом
 * `interface X {}`: eslint (`no-empty-object-type`) справедливо запрещает второе — пустой
 * интерфейс совместим с чем угодно и молча гасит типизацию. `Record<string, never>` же означает
 * ровно «событий пока нет» и при этом удовлетворяет ограничению `EventsMap` дженериков socket.io.
 * Инстансы не шлют друг другу событий через этот канал напрямую — координацию между ними несёт
 * Redis-адаптер (SLT-34), прозрачно поверх обычных `server.to(room).emit`/`socket.to(room).emit`.
 */
export type InterServerEvents = Record<string, never>;

const BOARD_ROOM_PREFIX = 'board:';

/** Комната доски: `board:<boardId>`. Broadcast событий доски идёт только сюда, не глобально. */
export const boardRoom = (boardId: string): string => `${BOARD_ROOM_PREFIX}${boardId}`;

/**
 * Обратное к `boardRoom`: достаёт boardId из имени комнаты socket.io, или `null`, если это не
 * комната доски (например, собственная room-по-id, которую socket.io заводит на каждый сокет).
 *
 * Нужна presence (SLT-35) и её серверному тику: чтобы почистить/просканировать состояние сокета
 * по всем доскам, которыми он владеет, единственный источник правды — `socket.rooms` (сам
 * socket.io), а не отдельный реестр `room → boardId` — заводить его специально было бы
 * дублированием того, что уже знает транспорт.
 */
export function boardIdFromRoom(room: string): string | null {
  return room.startsWith(BOARD_ROOM_PREFIX) ? room.slice(BOARD_ROOM_PREFIX.length) : null;
}

/** boardId всех комнат-досок из набора комнат сокета (свою id-комнату и не-board строки отсеивает). */
export function boardIdsFromRooms(rooms: Iterable<string>): string[] {
  const boardIds: string[] = [];

  for (const room of rooms) {
    const boardId = boardIdFromRoom(room);

    if (boardId !== null) {
      boardIds.push(boardId);
    }
  }

  return boardIds;
}

/**
 * Полезная нагрузка `join_board`/`leave_board`. Один сокет живёт всё время сессии и по мере
 * открытия/закрытия досок входит и выходит из их комнат — без реконнекта на навигацию.
 */
export interface BoardMembershipPayload {
  boardId: string;
}

/**
 * Достаёт boardId из недоверенного payload события. `null` ⇒ payload не той формы (не объект,
 * нет поля, не строка, пустая строка) — вызывающий трактует это как «доски нет».
 *
 * Общая для двух потребителей (SLT-35): `BoardRoomService` (членство) и `PresenceService`
 * (онлайн-реестр) разбирают ОДИН и тот же payload `join_board`/`leave_board` независимо друг от
 * друга — каждый через этот единый парсер, а не через приватную копию. Так оба свежие правила
 * «кривой ввод не долетает до Redis/Prisma» проверяются в одном месте и не расходятся.
 */
export function extractBoardId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { boardId } = payload as { boardId?: unknown };

  return typeof boardId === 'string' && boardId.length > 0 ? boardId : null;
}

/**
 * Причина отказа во входе в комнату. ЕДИНСТВЕННАЯ и намеренно неразличающая «доски нет» и «доска
 * не твоя» — симметрично HTTP 404 board-слоя (см. boardNotFound): раздельные причины выдавали бы
 * посторонему, какие boardId существуют. Presence/sync добавят свои коды рядом, если понадобятся.
 */
export type BoardJoinDeniedReason = 'board_not_found';

/**
 * Результат `join_board`, едущий назад ack-callback'ом (а не отдельным `join_error`-событием):
 * клиент шлёт `join_board` с callback и в нём же получает исход. Дискриминированное объединение по
 * `ok` заставляет клиента разобрать отказ прежде, чем считать себя в комнате.
 */
export type BoardJoinResult = { ok: true } | { ok: false; reason: BoardJoinDeniedReason };

/**
 * Участник presence с именем (SLT-37: клиенту нужен displayName для аватаров/подписи курсора, а
 * резолвить его N отдельными запросами с фронта — лишний round-trip на снимок, который может
 * перечислять много юзеров разом). Сервер резолвит имя централизованно (см. PresenceService) —
 * дешевле один раз в одном месте, чем на каждом клиенте по отдельности.
 */
export interface PresenceUser {
  userId: string;
  displayName: string;
}

/** Снимок онлайна доски, едущий входящему сокету единожды — сразу после успешного `join_board`. */
export interface PresenceSnapshotPayload {
  users: PresenceUser[];
}

/** Payload `presence_join`: юзер стал онлайн — несёт имя, т.к. остальные ещё не знают, кто это. */
export type PresenceJoinPayload = PresenceUser;

/**
 * Payload `presence_leave`: только userId. Имя тут не нужно — клиент убирает существующую запись
 * онлайн-списка/курсор по userId, а не создаёт новую; резолвить его ради события, которое всё
 * равно всё удаляет, было бы лишней Redis/Prisma работой без потребителя результата.
 */
export interface PresenceDeltaPayload {
  userId: string;
}

/**
 * Координаты курсора в МИРОВОЙ системе координат холста (не экранных пикселях) — конверсия
 * мир↔экран целиком на фронте (SLT-37), сервер числа не интерпретирует, только валидирует форму
 * и ретранслирует. Диапазон намеренно не ограничен: холст бесконечный, любые конечные x/y валидны.
 */
export interface CursorPosition {
  x: number;
  y: number;
}

/** Payload исходящего `cursor_move`: координаты плюс userId отправителя (добавляет сервер). */
export interface CursorMovePayload extends CursorPosition {
  userId: string;
}

/** Payload `cursor_leave`: только userId — координата тут не при чём, событие о видимости курсора. */
export interface CursorLeavePayload {
  userId: string;
}

/**
 * Достаёт координаты курсора из недоверенного payload `cursor_move`. `null` ⇒ форма неверна (не
 * объект, x/y не числа или не конечны — NaN/Infinity) — вызывающий (CursorService) тихо дропает
 * событие, не ретранслируя его дальше. Курсор — высокочастотный поток, а не разовый ввод: одна
 * сломанная координата от кривого клиента не должна ломать отрисовку у всех остальных участников.
 */
export function extractCursorPosition(payload: unknown): CursorPosition | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { x, y } = payload as { x?: unknown; y?: unknown };

  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  return { x, y };
}

/**
 * Синхронизация мутаций элементов (SLT-38, 3.3) — сервер начинает диктовать изменения обратно
 * клиентам, впервые с начала этапа 3. Три входящих события, по одному на операцию
 * (`element_create`/`element_update`/`element_delete`), поверх той же room-модели (SLT-33):
 * сокет обязан состоять в комнате `board:<boardId>`, иначе мутация отклоняется ДО обращения к
 * персист-слою — форма ошибки та же (`access_denied`), что и остальные причины отказа, ack'ом.
 *
 * ПОЧЕМУ ТРИ СОБЫТИЯ, А НЕ ОДНО `element_mutated` С ТИПОМ ОПЕРАЦИИ В ПОЛЕ. Разные payload'ы
 * (create несёт полную форму фигуры, delete — только id/version) означали бы либо union по
 * дискриминатору внутри одного события (клиент разбирает вручную), либо раздутый общий тип с
 * опциональными полями под каждую операцию. Прецедент в этом же файле — presence_join/leave и
 * cursor_move/leave: везде выбраны раздельные события с точной формой, а не общий конверт с
 * discriminator'ом. Три события здесь — то же самое решение, применённое ещё раз для
 * согласованности транспорта.
 *
 * ПОЧЕМУ ZOD, А НЕ РУЧНЫЕ extract*-ФУНКЦИИ (как у cursor/presence). Форма элемента — 10+ полей
 * с диапазонами (opacity, strokeWidth) и дискриминированной по `type` геометрией. Она уже
 * описана ОДИН раз как `upsertElementSchema`/`patchElementSchema` в @slate/shared-types (SLT-23)
 * — тем же кодом, которым её проверяет HTTP-путь и фронт. Переписать это вручную здесь значило
 * бы завести вторую копию тех же правил валидации, которая рано или поздно разойдётся с первой.
 * `zod` — не новая зависимость: она уже в apps/api (см. config/env.schema.ts), просто впервые
 * применяется к WS-payload'у.
 *
 * КОНТРАКТ ЭЛЕМЕНТА НЕ ДУБЛИРУЕТСЯ: `ElementCreatePayload`/`ElementSyncDto` строятся ПОВЕРХ
 * `UpsertElementInput`/`ElementDto` (импорт из @slate/shared-types и element-модуля), а не
 * переписывают форму элемента заново, — ровно то ограничение, о котором просит SLT-38.
 */

/** UUID id из payload'а недоверенного события. `null` ⇒ поля нет, оно не строка или не UUID. */
export function extractElementId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { id } = payload as { id?: unknown };

  return typeof id === 'string' && z.uuid().safeParse(id).success ? id : null;
}

/**
 * Состоит ли сокет ПРЯМО СЕЙЧАС в комнате указанной доски. Авторизация WS-мутаций элемента:
 * членство проверяется по факту (`join_board`, SLT-33), а не переспрашивается у BoardService —
 * повторный поход в БД на КАЖДУЮ мутацию (autosave-путь, десятки в минуту) был бы лишним
 * round-trip'ом поверх того, что комната и так уже это гарантирует.
 */
export function isInBoardRoom(socket: AppSocket, boardId: string): boolean {
  return socket.rooms.has(boardRoom(boardId));
}

/**
 * Элемент в WS-контракте: форма ElementDto (HTTP) плюс `version` — то, что PATCH/PUT по HTTP
 * сознательно скрывают (SLT-13/20), а WS-мутациям обязана видеть: следующая правка клиента
 * несёт version ИМЕННО отсюда как ожидаемую. Долг реестра SLT-22 (version наружу) закрывается
 * здесь, а не в HTTP-DTO — см. решение в element.dto.ts.
 */
export interface ElementSyncDto extends ElementDto {
  version: number;
}

/** Сущность → WS-DTO. Переиспользует `toElementDto` (не копирует поля) и добавляет version. */
export function toElementSyncDto(element: ElementEntity): ElementSyncDto {
  return { ...toElementDto(element), version: element.version };
}

/**
 * Payload `element_create`: полная форма фигуры (та же, что PUT-тело — `UpsertElementInput`)
 * плюс клиентский `id` (на HTTP он едет в URL, здесь URL нет — только payload).
 */
export type ElementCreatePayload = UpsertElementInput & { id: string };

/** Payload `element_update`: адрес + изменения (форма PATCH-тела) + ожидаемая version. */
export interface ElementUpdatePayload {
  boardId: string;
  id: string;
  version: number;
  changes: PatchElementInput;
}

/** Payload `element_delete`: адрес + ожидаемая version — тела для удаления не требуется. */
export interface ElementDeletePayload {
  boardId: string;
  id: string;
  version: number;
}

/** Форма `changes` в `element_update`, включая пустое тело — валидность решает ElementService. */
export const elementUpdatePayloadSchema = z.object({
  boardId: z.uuid(),
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  changes: patchElementSchema,
});

/** Форма `element_delete` — то же адресное трио, без `changes`. */
export const elementDeletePayloadSchema = z.object({
  boardId: z.uuid(),
  id: z.uuid(),
  version: z.number().int().nonnegative(),
});

/**
 * Причина отказа мутации, различимая в ack (SLT-38, дополнено SLT-41):
 *  - `access_denied` — сокет не в комнате доски из payload'а (комната есть у ЛЮБОЙ роли,
 *    включая viewer, — этот отказ значит «не входил» / «доски не видно вовсе», не «роли мало»);
 *  - `forbidden` — сокет В КОМНАТЕ (доступ есть), но роль `viewer`: писать может только
 *    `editor`/`owner` (SLT-41, `canWrite`). Отдельно от `access_denied`: там доски не видно
 *    вовсе, здесь она видна на чтение — разные причины, разная реакция клиента;
 *  - `not_found` — элемент недоступен/не существует/удалён (update/delete) или доска исчезла
 *    между проверкой и записью (create, симметрично HTTP board-missing);
 *  - `version_conflict` — update/delete: ожидаемая version устарела (несёт актуальный элемент);
 *  - `conflict` — create: id занят элементом другой доски ИЛИ смена типа существующего элемента
 *    (оба случая — 409-правило SLT-20, сохранённое здесь без изменений);
 *  - `invalid_payload` — форма не прошла zod/доменную проверку (в т.ч. геометрия не по типу).
 */
export type ElementMutationRejectReason =
  | 'access_denied'
  | 'forbidden'
  | 'not_found'
  | 'version_conflict'
  | 'conflict'
  | 'invalid_payload';

/** Ack `element_create`. */
export type ElementCreateAckResult =
  | { ok: true; element: ElementSyncDto }
  | { ok: false; reason: Exclude<ElementMutationRejectReason, 'version_conflict'> };

/**
 * Ack `element_update`. `version_conflict` — единственная причина, несущая элемент (см.
 * ElementMutationRejectReason): клиенту нужно свежее состояние для refetch-and-reapply (SLT-40).
 */
export type ElementUpdateAckResult =
  | { ok: true; element: ElementSyncDto }
  | { ok: false; reason: 'version_conflict'; element: ElementSyncDto }
  | { ok: false; reason: Exclude<ElementMutationRejectReason, 'version_conflict' | 'conflict'> };

/** Ack `element_delete`. Успех несёт не элемент, а id/version — удалённой фигуре нечего слать. */
export type ElementDeleteAckResult =
  | { ok: true; id: string; version: number }
  | { ok: false; reason: 'version_conflict'; element: ElementSyncDto }
  | { ok: false; reason: Exclude<ElementMutationRejectReason, 'version_conflict' | 'conflict'> };

/**
 * Broadcast `element_created`/`element_updated`: ПОЛНЫЙ элемент, не дельта. Идемпотентность
 * (применить дважды — тот же результат), простота на клиенте (замена целиком, не мерж) и
 * устойчивость к пропущенным событиям (каждое сообщение самодостаточно) — см. класс-докстринг
 * ElementSyncService. `userId` — метаданные автора (кто изменил), НЕ механизм анти-эха: анти-эхо
 * даёт `socket.to` (физическое неполучение своего же события отправителем).
 */
export interface ElementBroadcastPayload {
  element: ElementSyncDto;
  userId: string;
}

/** Broadcast `element_deleted`: id + новая version + признак удаления — геометрии в нём уже нет. */
export interface ElementDeletedBroadcastPayload {
  id: string;
  version: number;
  userId: string;
}

/**
 * Батч-мутации элементов (SLT-68) — гомогенный транспорт поверх ТОЙ ЖЕ версионной семантики, что у
 * одиночных `element_update`/`element_delete` (см. докстринг ElementSyncService про переиспользование
 * `patchVersioned`/`removeVersioned`). Только update и delete — `element_batch_create` не заводим:
 * create сейчас идёт по одному, батч ему понадобится вместе с paste, отдельной задачей.
 *
 * ПОЭЛЕМЕНТНЫЙ УСПЕХ (Р2, зафиксировано на точке сверки SLT-68), не атомарный all-or-nothing: каждый
 * элемент батча применяется своей НЕЗАВИСИМОЙ conditional-update-инструкцией (та же атомарная
 * `UPDATE...WHERE id=? AND version=?`, что у одиночной мутации) — конфликт версии ОДНОГО элемента не
 * откатывает остальные. Ack поэтому не `{ok: true/false}` на весь батч, а `{applied, conflicts}`:
 * какие элементы применились, какие — нет и почему.
 *
 * `conflicts` — ОДНА корзина на все причины отказа отдельного элемента (version_conflict/not_found/
 * forbidden/invalid_payload), не четыре отдельных списка: с точки зрения клиента все они означают
 * одно и то же действие — «этот элемент батча не применился», разбор ПОЧЕМУ нужен только для того,
 * чтобы применить актуальное состояние (`element` есть только у `version_conflict`, см.
 * ElementBatchConflictEntry) или показать баннер (остальные kind — тем же кодом, что у single,
 * classifyRejectReason на фронте). Ack-уровня `access_denied`/`invalid_payload` (payload битый
 * целиком или сокет не в комнате) — это отказ ВСЕГО батча, до разбора по элементам, симметрично
 * тому, как `isInBoardRoom` отсекает одиночную мутацию ДО похода в ElementService.
 */

/** Верхняя граница числа элементов в одной батч-мутации — клиенту в этом нельзя доверять (Р7). */
export const MAX_BATCH_SIZE = 500;

/** Один элемент батч-обновления — тот же адрес+патч, что у `ElementUpdatePayload`, без своего boardId. */
export interface ElementBatchUpdateItem {
  id: string;
  version: number;
  changes: PatchElementInput;
}

/** Payload `element_batch_update`: один boardId на весь батч (гомогенный по доске) + массив патчей. */
export interface ElementBatchUpdatePayload {
  boardId: string;
  items: ElementBatchUpdateItem[];
}

/** Один элемент батч-удаления — адрес+ожидаемая version, без тела (симметрично `ElementDeletePayload`). */
export interface ElementBatchDeleteItem {
  id: string;
  version: number;
}

/** Payload `element_batch_delete`: то же адресное трио на уровне батча. */
export interface ElementBatchDeletePayload {
  boardId: string;
  items: ElementBatchDeleteItem[];
}

/** Форма `element_batch_update`: непустой массив ≤ MAX_BATCH_SIZE, каждый item — как одиночный update. */
export const elementBatchUpdatePayloadSchema = z.object({
  boardId: z.uuid(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        version: z.number().int().nonnegative(),
        changes: patchElementSchema,
      }),
    )
    .min(1)
    .max(MAX_BATCH_SIZE),
});

/** Форма `element_batch_delete` — то же адресное трио на item, без `changes`. */
export const elementBatchDeletePayloadSchema = z.object({
  boardId: z.uuid(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        version: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(MAX_BATCH_SIZE),
});

/**
 * Причина, по которой ОДИН элемент батча не применился. Подмножество `ElementMutationRejectReason`
 * без `access_denied` (это отказ всего батча, см. класс-докстринг) и без `conflict` (create-only,
 * которого в батче нет).
 */
export type ElementBatchItemRejectReason =
  | 'not_found'
  | 'forbidden'
  | 'invalid_payload'
  | 'version_conflict';

/** Запись в `conflicts`: `element` есть ТОЛЬКО у version_conflict — клиенту нужно свежее состояние
 * для LWW (см. класс-докстринг), у остальных причин прикладывать нечего. */
export type ElementBatchConflictEntry =
  | { id: string; kind: 'version_conflict'; element: ElementSyncDto }
  | { id: string; kind: Exclude<ElementBatchItemRejectReason, 'version_conflict'> };

/** Ack `element_batch_update`. Батч-уровневый reject — ДО разбора по элементам (см. класс-докстринг). */
export type ElementBatchUpdateAckResult =
  | { ok: true; applied: ElementSyncDto[]; conflicts: ElementBatchConflictEntry[] }
  | { ok: false; reason: 'access_denied' | 'invalid_payload' };

/** Ack `element_batch_delete`. Успех несёт id/version (симметрично одиночному delete), не элемент. */
export type ElementBatchDeleteAckResult =
  | { ok: true; applied: { id: string; version: number }[]; conflicts: ElementBatchConflictEntry[] }
  | { ok: false; reason: 'access_denied' | 'invalid_payload' };

/**
 * Batch-broadcast `element_batch_updated`/`element_batch_deleted` (Р4) — ОДИН broadcast на весь
 * батч, несёт ТОЛЬКО успешно применённые элементы (финальное состояние). Партнёр применяет их одним
 * проходом/одним `set()` (см. applyRemoteBatchUpdate/Delete на фронте) — не N отдельных broadcast'ов
 * и не N отдельных ререндеров. Конфликтные элементы НЕ транслируются: у партнёра уже актуальное
 * состояние (иначе конфликта не было бы), а инициатор разрешает свои конфликты из ack.
 */
export interface ElementBatchBroadcastPayload {
  elements: ElementSyncDto[];
  userId: string;
}

/** Batch-broadcast удаления: те же id+version пары, что несёт ack, плюс автор. */
export interface ElementBatchDeletedBroadcastPayload {
  deletions: { id: string; version: number }[];
  userId: string;
}

/**
 * События клиент→сервер (SLT-33/35/36):
 *   - `join_board` несёт ack — вход авторизуется (см. BoardRoomService), и исход обязан вернуться;
 *   - `leave_board` без ack — выход из комнаты не может быть отклонён (проверять нечего) и
 *     идемпотентен, подтверждать нечего;
 *   - `presence_ping` — прикладной heartbeat presence (см. PresenceService), без payload: клиент
 *     сигналит «я жив» на все доски, в комнатах которых сейчас состоит его сокет, разом. Ожидаемый
 *     интервал на клиенте — 20с (SLT-37); порог офлайна на сервере — 60с (3 пропуска).
 *   - `cursor_move` — позиция курсора (см. CursorService), без ack: это высокочастотный поток, а не
 *     дискретная операция с исходом. Клиент throttle-ит отправку до ~20-30/сек (SLT-37); сервер не
 *     доверяет этому и держит свой потолок сверху (см. CursorService).
 *   - `cursor_leave` — мышь ушла за пределы холста, без payload: юзер остаётся онлайн (presence не
 *     трогается), просто курсор больше не над доской и должен исчезнуть у остальных.
 */
export interface ClientToServerEvents {
  join_board: (payload: BoardMembershipPayload, ack: (result: BoardJoinResult) => void) => void;
  leave_board: (payload: BoardMembershipPayload) => void;
  presence_ping: () => void;
  cursor_move: (payload: CursorPosition) => void;
  cursor_leave: () => void;
  /** Создание/замена/воскрешение элемента (SLT-38) — ack обязателен, как у join_board. */
  element_create: (
    payload: ElementCreatePayload,
    ack: (result: ElementCreateAckResult) => void,
  ) => void;
  /** Версионированное частичное обновление элемента (SLT-38). */
  element_update: (
    payload: ElementUpdatePayload,
    ack: (result: ElementUpdateAckResult) => void,
  ) => void;
  /** Версионированное мягкое удаление элемента (SLT-38). */
  element_delete: (
    payload: ElementDeletePayload,
    ack: (result: ElementDeleteAckResult) => void,
  ) => void;
  /** Батч-обновление (SLT-68) — поэлементный успех, см. класс-докстринг у батч-типов выше. */
  element_batch_update: (
    payload: ElementBatchUpdatePayload,
    ack: (result: ElementBatchUpdateAckResult) => void,
  ) => void;
  /** Батч-удаление (SLT-68). */
  element_batch_delete: (
    payload: ElementBatchDeletePayload,
    ack: (result: ElementBatchDeleteAckResult) => void,
  ) => void;
}

/**
 * События сервер→клиент (SLT-35/36):
 *   - `presence_snapshot` — единичный снимок текущего онлайна доски (с displayName), входящему
 *     сокету при join;
 *   - `presence_join`/`presence_leave` — дельты по userId (не по сокету), когда юзер целиком
 *     переходит между офлайном и онлайном (см. PresenceService про 0→1/1→0 на уровне userId);
 *     `presence_join` несёт displayName (новый участник, остальные его ещё не знают),
 *     `presence_leave` — только userId (клиент убирает по нему, имя не нужно);
 *   - `cursor_move`/`cursor_leave` — relay координат курсора (см. CursorService), НЕ presence:
 *     юзер остаётся онлайн всё это время, дельты тут про видимость курсора на слое, а не про членство.
 */
export interface ServerToClientEvents {
  presence_snapshot: (payload: PresenceSnapshotPayload) => void;
  presence_join: (payload: PresenceJoinPayload) => void;
  presence_leave: (payload: PresenceDeltaPayload) => void;
  cursor_move: (payload: CursorMovePayload) => void;
  cursor_leave: (payload: CursorLeavePayload) => void;
  /** Мутация применена другим участником комнаты (SLT-38) — полный элемент, не дельта. */
  element_created: (payload: ElementBroadcastPayload) => void;
  element_updated: (payload: ElementBroadcastPayload) => void;
  element_deleted: (payload: ElementDeletedBroadcastPayload) => void;
  /** Батч-broadcast (SLT-68) — один на весь батч, только применённые элементы. */
  element_batch_updated: (payload: ElementBatchBroadcastPayload) => void;
  element_batch_deleted: (payload: ElementBatchDeletedBroadcastPayload) => void;
}

/**
 * Данные, привязанные к сокету на всё время соединения (`socket.data`).
 *
 * `userId` кладёт сюда ws-auth-middleware ПОСЛЕ успешной проверки сессии — анонимный сокет до
 * этой точки не доходит (соединение отклоняется на handshake). Поэтому поле обязательное, а не
 * опциональное: к моменту, когда до `socket.data` дотянется обработчик события, пользователь
 * уже гарантированно опознан.
 *
 * `sessionGen` (SLT-35) — снимок поколения сессии (SLT-31) на момент handshake, той же природы,
 * что и `req.session.sessionGen`: middleware кладёт его сюда РЯДОМ с userId, одним снимком с одного
 * чтения сессии. Серверный presence-тик сверяет его с актуальным поколением в Redis и рвёт сокет
 * при расхождении (logout-everywhere должен реально закрывать соединение, а не только сбрасывать
 * пользователя из presence по TTL). Обязательное по той же причине, что и userId.
 *
 * `lastCursorMoveAt` (SLT-36) — timestamp последнего ПРИНЯТОГО `cursor_move` этого сокета, для
 * серверного throttle-дропа в `CursorService`. В отличие от `userId`/`sessionGen` необязательное и
 * НЕ заполняется ws-auth-middleware: до первого `cursor_move` его просто нет. Живёт в `SocketData`,
 * а не в отдельной `Map<socketId, number>` в сервисе — так состояние уходит вместе с сокетом само
 * (GC), без риска утечки на disconnect, которую пришлось бы чистить руками при внешнем Map.
 */
export interface SocketData {
  userId: string;
  sessionGen: number;
  lastCursorMoveAt?: number;
}

/** Типизированный socket.io-сервер приложения. Дженерики фиксируют контракт событий и данных. */
export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Типизированный сокет одного клиента — с тем же контрактом, что и сервер. */
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
