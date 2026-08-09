import { Injectable } from '@nestjs/common';
import { type BoardMemberRole, Prisma } from '@slate/database';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { accessibleBoardScope } from './board.access';
import { ownerManagedMemberScope } from './board-member.access';
import { BOARD_MEMBER_SELECT, type BoardMemberEntity } from './entities/board-member.entity';

/** Коды Prisma со значением для этого репозитория. Выше по стеку про них знать не положено. */
const UNIQUE_VIOLATION = 'P2002';
const FOREIGN_KEY_VIOLATION = 'P2003';
const RECORD_NOT_FOUND = 'P2025';

/** Данные вставки. `boardId`/`userId` уже проверены сервисом (владелец, существующий инвайти). */
export interface CreateMemberData {
  boardId: string;
  userId: string;
  role: BoardMemberRole;
}

/**
 * Чем закончилась попытка пригласить. Три исхода различает именно репозиторий — только он видит
 * коды Prisma (та же граница, что у `CreateElementOutcome`).
 *
 * `already-member` — нарушение `@@unique([boardId, userId])`: приглашаемый уже состоит в доске.
 * `board-missing` — гонка между проверкой владения (сервис) и вставкой: доску удалили в этот
 * промежуток, и `boardId` не прошёл внешний ключ. Редкий, но реальный случай, как у
 * `ElementRepository.create` — без отдельной ветки он отдал бы 500 вместо честного 404.
 */
export type CreateMemberOutcome =
  | { status: 'created'; member: BoardMemberEntity }
  | { status: 'already-member' }
  | { status: 'board-missing' };

/**
 * Единственная точка доступа к Prisma для членства (`BoardMember`).
 *
 * Отдельный репозиторий, а не разбухший BoardRepository — по тому же принципу, что развёл Board и
 * Element (SLT-20): у членства своя ЖИЗНЬ (пригласить/сменить роль/отозвать/перечислить), а не
 * единственное поле доски. BoardRepository и так несёт owner-only жизненный цикл ДОСКИ
 * (rename/delete) — валить в него ещё и жизненный цикл ШЕРИНГА значило бы смешать два разных
 * агрегата в одном файле, которые меняются по разным причинам.
 *
 * «Тупой», как и остальные репозитории модуля: ни одной бизнес-проверки. Владение (только owner
 * управляет) выражено СКОУПОМ запроса (`ownerManagedMemberScope`), а не отдельным if.
 */
@Injectable()
export class BoardMemberRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Вставка членства. Владение уже проверено сервисом (`BoardService.getAccess` === 'owner') —
   * здесь его перепроверять нечем: строки ещё не существует, `where` вклеить некуда, ровно как у
   * `ElementRepository.create`.
   */
  async create({ boardId, userId, role }: CreateMemberData): Promise<CreateMemberOutcome> {
    try {
      const member = await this.prisma.boardMember.create({
        data: { boardId, userId, role },
        select: BOARD_MEMBER_SELECT,
      });

      return { status: 'created', member };
    } catch (error) {
      if (isPrismaError(error, UNIQUE_VIOLATION)) {
        return { status: 'already-member' };
      }

      if (isPrismaError(error, FOREIGN_KEY_VIOLATION)) {
        return { status: 'board-missing' };
      }

      throw error;
    }
  }

  /**
   * Смена роли — ТОЛЬКО у владельца доски (`ownerManagedMemberScope`), атомарно: проверка
   * владения и запись — один запрос, без окна между ними (см. докстринг scope-функции).
   *
   * `null` ⇒ участника нет, доска не твоя (не owner) или её вовсе не существует — три причины,
   * одно значение: сервис не в состоянии перепутать их случайно.
   */
  async updateRole(
    boardId: string,
    ownerId: string,
    memberUserId: string,
    role: BoardMemberRole,
  ): Promise<BoardMemberEntity | null> {
    try {
      // `await` внутри try обязателен: без него промис уедет наружу и catch не сработает.
      return await this.prisma.boardMember.update({
        where: ownerManagedMemberScope(boardId, memberUserId, ownerId),
        data: { role },
        select: BOARD_MEMBER_SELECT,
      });
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        return null;
      }

      throw error;
    }
  }

  /** Отзыв членства — тот же owner-only scope, что и у `updateRole`. `false` ⇒ см. её докстринг. */
  async remove(boardId: string, ownerId: string, memberUserId: string): Promise<boolean> {
    try {
      await this.prisma.boardMember.delete({
        where: ownerManagedMemberScope(boardId, memberUserId, ownerId),
        select: { id: true },
      });

      return true;
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Список участников — ЧТЕНИЕ, поэтому scope шире записи: owner ∪ участник любой роли
   * (`accessibleBoardScope`, SLT-41), не owner-only. Viewer вправе знать, с кем делит доску, —
   * это read, не управление (SLT-42, решение 2).
   *
   * Вложенный запрос через `Board`, как у `findElements`: одно выражение и для доступа, и для
   * данных — отдельный `boardMember.findMany({ where: { boardId } })` пришлось бы вручную
   * сопровождать проверкой прав, и однажды её не напишут.
   *
   * `null` ⇒ доска недоступна или не существует (сервис отвечает 404), пустой массив ⇒ доступна,
   * но участников (кроме owner'а, которого здесь и не может быть) пока нет.
   */
  async findMembersAccessible(
    boardId: string,
    userId: string,
  ): Promise<BoardMemberEntity[] | null> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, ...accessibleBoardScope(userId) },
      select: {
        members: { select: BOARD_MEMBER_SELECT, orderBy: { createdAt: 'asc' } },
      },
    });

    return board?.members ?? null;
  }
}

/** Перевод ошибки ORM на язык домена — единственное, что репозиторию позволено решать про ошибки. */
function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
