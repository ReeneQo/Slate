import { Injectable } from '@nestjs/common';
import { Prisma } from '@slate/database';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ELEMENT_ORDER_BY,
  ELEMENT_SELECT,
  type ElementEntity,
  LIVE_ELEMENT_WHERE,
} from '../element/entities/element.entity';
import { accessibleBoardScope, type AccessLevel, resolveAccessLevel } from './board.access';
import { BOARD_SELECT, type BoardEntity } from './entities/board.entity';

/** Код Prisma для «запись под условие не найдена» (update/delete не нашли строку). */
const RECORD_NOT_FOUND = 'P2025';

/** Данные вставки. `ownerId` обязателен и приходит от сервиса — из сессии, не из тела запроса. */
export interface CreateBoardData {
  ownerId: string;
  /** `undefined` означает «не передавать колонку в INSERT» — сработает `@default("Untitled")`. */
  title?: string;
}

/** Данные обновления. `version` здесь НЕТ намеренно: его инкрементит репозиторий, не вызывающий. */
export interface UpdateBoardData {
  title: string;
}

/**
 * Единственная точка доступа к Prisma для доски.
 *
 * Репозиторий «тупой»: ни одной бизнес-проверки и ни одного throw о правах. Но проверка
 * ДОСТУПА живёт именно здесь — и это не противоречие. Доступ выражен не как правило («если
 * не владелец — ошибка»), а как область видимости запроса: методы с суффиксом `Accessible`
 * физически не могут прочитать или изменить чужую доску, потому что scope вклеен в тот же
 * `where` (см. board.access.ts). Правило «а что показать пользователю, если не нашли» —
 * решение сервиса.
 *
 * Отсюда же и форма возврата: `null` / `false` вместо исключения. Репозиторий сообщает факт
 * («под этот scope строки нет»), а какой это HTTP-статус — вопрос сценария, и на него
 * отвечает BoardService. Ровно та же граница, что у UserRepository с P2002.
 */
@Injectable()
export class BoardRepository {
  constructor(private readonly prisma: PrismaService) {}

  create({ ownerId, title }: CreateBoardData): Promise<BoardEntity> {
    // `select` нужен и на create: без него Prisma вернёт всю вставленную строку, включая version.
    return this.prisma.board.create({ data: { ownerId, title }, select: BOARD_SELECT });
  }

  /**
   * «Мои доски» — только СВОИ, безо всяких OR. Имя метода несёт эту гарантию намеренно:
   * когда на этапе 3 появится шеринг, `findAllOwnedBy` не примут за «все доступные», и
   * добавление расшаренных досок в дашборд станет отдельным осознанным решением
   * (`findAllAccessibleBy` или два раздела в интерфейсе), а не побочным эффектом правки
   * общего хелпера. Область видимости КОНКРЕТНОЙ доски и состав СПИСКА — разные вопросы,
   * и сейчас они совпадают лишь потому, что шеринга нет.
   *
   * Сортировка по updatedAt: на дашборде сверху то, что правил последним. Считает БД, а не
   * сервис, — сортировать в приложении означало бы тянуть все строки, чтобы упорядочить.
   */
  findAllOwnedBy(ownerId: string): Promise<BoardEntity[]> {
    return this.prisma.board.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      select: BOARD_SELECT,
    });
  }

  /**
   * Метаданные доски, если она доступна этому пользователю.
   *
   * `findFirst`, а не `findUnique`: уникальный поиск принимает только уникальные поля, а нам
   * нужно сузить выборку ещё и по владельцу — иначе доска сначала будет прочитана, и лишь
   * потом отброшена (см. board.access.ts, почему это плохо).
   *
   * Булева `canAccess(boardId, userId)` намеренно не заведена: она означала бы запрос
   * «а можно?» отдельно от запроса «дай данные» — то есть два обращения к БД и окно между
   * ними. Здесь ответ на оба вопроса один: строка нашлась ⇒ доступ есть.
   */
  findAccessible(boardId: string, userId: string): Promise<BoardEntity | null> {
    return this.prisma.board.findFirst({
      where: { id: boardId, ...accessibleBoardScope(userId) },
      select: BOARD_SELECT,
    });
  }

  /**
   * Уровень доступа пользователя к доске — без чтения содержимого самой доски (SLT-41).
   *
   * Заменяет булеву `existsAccessible` (SLT-19): «есть доступ» и «какая роль» — один и тот же
   * вопрос к БД, и раздельные `canAccess`+`getRole` заставили бы вызывающего, которому нужна
   * роль (проверка перед мутацией), ходить в базу дважды за тем, что тут отдаётся одним
   * запросом. `select` берёт ровно то, что нужно `resolveAccessLevel`: `ownerId` — для ветки
   * owner, `members` (уже отфильтрованные по этому userId) — для роли участника.
   *
   * Единственное живое исключение — ВСТАВКА элемента (SLT-20): вклеить scope в `INSERT`
   * невозможно, строки ещё не существует, и `ElementService.createElement` спрашивает уровень
   * здесь заранее. Окно между этой проверкой и вставкой закрыто не тут, а внешним ключом:
   * исчезни доска в этот момент, INSERT упадёт на FK, и ElementRepository переведёт это в
   * доменный отказ.
   */
  async getAccessLevel(boardId: string, userId: string): Promise<AccessLevel> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...accessibleBoardScope(userId) },
      select: { ownerId: true, members: { where: { userId }, select: { role: true } } },
    });

    return resolveAccessLevel(board, userId);
  }

  /**
   * Живые элементы доски. `null` ⇒ доска недоступна или не существует — сервису этого
   * достаточно, чтобы ответить 404, и он не в состоянии перепутать «нет доступа» с «доска
   * пустая» (пустой холст — это `[]`).
   *
   * Элементы читаются ВЛОЖЕННО, под тем же access-scoped запросом к доске. Так проверка
   * доступа не может быть забыта: отдельный `element.findMany({ where: { boardId } })`
   * пришлось бы вручную сопровождать проверкой прав на доску, и однажды её не напишут.
   * Здесь scope и данные — одно выражение.
   */
  async findElements(boardId: string, userId: string): Promise<ElementEntity[] | null> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...accessibleBoardScope(userId) },
      select: {
        elements: {
          where: LIVE_ELEMENT_WHERE,
          orderBy: ELEMENT_ORDER_BY,
          select: ELEMENT_SELECT,
        },
      },
    });

    return board?.elements ?? null;
  }

  /**
   * Переименование. `null` ⇒ доска недоступна или не существует.
   *
   * ЕДИНСТВЕННАЯ точка инкремента version на всё приложение. Инкремент атомарный, на стороне
   * БД (`version = version + 1`), а не «прочитать, прибавить, записать»: два параллельных
   * PATCH'а во втором варианте прочитали бы одно значение и записали одинаковое, потеряв одну
   * ревизию. Оптимистическая блокировка этапа 3 будет опираться на этот счётчик, и пропущенные
   * инкременты сломали бы её незаметно.
   *
   * Проверка доступа и запись — ОДИН запрос: `where` содержит и id, и scope (Prisma это
   * позволяет — extendedWhereUnique). Вариант «сначала findAccessible, потом update» оставил
   * бы окно между проверкой и записью.
   *
   * `where` — `{ id, ownerId }`, а НЕ `accessibleBoardScope(userId)` (SLT-41): переименование —
   * управление жизненным циклом доски, а не её содержимым, и остаётся владельцу так же, как
   * управление шерингом (SLT-42). Виджет доступа (owner ∪ member) относится к ЧТЕНИЮ и к
   * мутациям ЭЛЕМЕНТОВ (см. докстринг `accessibleBoardScope`), не к самой доске.
   */
  async updateAccessible(
    boardId: string,
    userId: string,
    { title }: UpdateBoardData,
  ): Promise<BoardEntity | null> {
    try {
      // `await` внутри try обязателен: без него промис уедет наружу и catch не сработает.
      return await this.prisma.board.update({
        where: { id: boardId, ownerId: userId },
        data: { title, version: { increment: 1 } },
        select: BOARD_SELECT,
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Удаление. `false` ⇒ доска недоступна или не существует.
   *
   * Элементы и участников сносит БД: на `Element.board_id` и `BoardMember.board_id` стоит
   * `ON DELETE CASCADE` (проверено в миграции 20260725144536_init). Явная транзакция не нужна
   * и была бы хуже: каскад выполняется внутри той же операции БД, то есть уже атомарен, а
   * ручное удаление детей в транзакции — это лишние round-trip'ы и вторая копия правила,
   * которое уже описано в схеме.
   *
   * `select: { id: true }` — чтобы Prisma не тянула удалённую строку целиком (её содержимое
   * никому не нужно, а в нём version).
   *
   * `where` — `{ id, ownerId }`, не `accessibleBoardScope` — та же причина, что у
   * `updateAccessible`: удаление доски владельцем-only, editor этого не может.
   */
  async deleteAccessible(boardId: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.board.delete({
        where: { id: boardId, ownerId: userId },
        select: { id: true },
      });

      return true;
    } catch (error) {
      if (isRecordNotFound(error)) {
        return false;
      }

      throw error;
    }
  }
}

/**
 * Перевод ошибки ORM на язык домена — единственное, что репозиторию позволено решать про
 * ошибки. Код P2025 виден только здесь: выше по стеку про Prisma знать не положено.
 *
 * Важно, что для update/delete «не найдено» и «нет доступа» — ОДНО И ТО ЖЕ событие: scope
 * вклеен в условие, и БД не различает «строки нет» и «строка есть, но не твоя». Именно
 * поэтому наружу невозможно отдать разные ответы на эти два случая даже случайно.
 */
function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND;
}
