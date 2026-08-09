import { Prisma } from '@slate/database';

import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BoardMemberRepository } from './board-member.repository';
import { BOARD_MEMBER_SELECT } from './entities/board-member.entity';

const OWNER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const MEMBER_USER_ID = '019fa40d-9c2f-7b41-a8e5-3f1d0b7c22aa';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';

/** Owner-only scope записи членства (SLT-42) — тот же приём проверки, что у board.repository.spec. */
const OWNER_MANAGED_WHERE = {
  boardId_userId: { boardId: BOARD_ID, userId: MEMBER_USER_ID },
  board: { ownerId: OWNER_ID },
};

/** Область видимости ЧТЕНИЯ доски (owner ∪ участник любой роли) — из board.repository.spec. */
const ACCESS_SCOPED_WHERE = {
  id: BOARD_ID,
  OR: [{ ownerId: MEMBER_USER_ID }, { members: { some: { userId: MEMBER_USER_ID } } }],
};

type BoardMemberCreate = (args: Prisma.BoardMemberCreateArgs) => Promise<unknown>;
type BoardMemberUpdate = (args: Prisma.BoardMemberUpdateArgs) => Promise<unknown>;
type BoardMemberDelete = (args: Prisma.BoardMemberDeleteArgs) => Promise<unknown>;
type BoardFindFirst = (args: Prisma.BoardFindFirstArgs) => Promise<unknown>;

function recordNotFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('No record was found for an update', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma error', { code, clientVersion: 'test' });
}

function createDependencies() {
  const create = jest.fn() as jest.MockedFunction<BoardMemberCreate>;
  const update = jest.fn() as jest.MockedFunction<BoardMemberUpdate>;
  const deleteMember = jest.fn() as jest.MockedFunction<BoardMemberDelete>;
  const findFirst = jest.fn() as jest.MockedFunction<BoardFindFirst>;

  const prisma = {
    boardMember: { create, update, delete: deleteMember },
    board: { findFirst },
  } as unknown as PrismaService;

  return {
    boardMemberRepository: new BoardMemberRepository(prisma),
    create,
    update,
    deleteMember,
    findFirst,
  };
}

describe('BoardMemberRepository', () => {
  describe('create', () => {
    it('пишет boardId/userId/role и select не тянет лишнего', async () => {
      const { boardMemberRepository, create } = createDependencies();
      create.mockResolvedValue({});

      await boardMemberRepository.create({
        boardId: BOARD_ID,
        userId: MEMBER_USER_ID,
        role: 'editor',
      });

      expect(create).toHaveBeenCalledWith({
        data: { boardId: BOARD_ID, userId: MEMBER_USER_ID, role: 'editor' },
        select: BOARD_MEMBER_SELECT,
      });
    });

    it('P2002 (уже участник) → already-member', async () => {
      const { boardMemberRepository, create } = createDependencies();
      create.mockRejectedValue(prismaError('P2002'));

      await expect(
        boardMemberRepository.create({ boardId: BOARD_ID, userId: MEMBER_USER_ID, role: 'editor' }),
      ).resolves.toEqual({ status: 'already-member' });
    });

    it('P2003 (доску удалили в гонке) → board-missing', async () => {
      const { boardMemberRepository, create } = createDependencies();
      create.mockRejectedValue(prismaError('P2003'));

      await expect(
        boardMemberRepository.create({ boardId: BOARD_ID, userId: MEMBER_USER_ID, role: 'editor' }),
      ).resolves.toEqual({ status: 'board-missing' });
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { boardMemberRepository, create } = createDependencies();
      const connectionFailure = new Error('connection terminated');
      create.mockRejectedValue(connectionFailure);

      await expect(
        boardMemberRepository.create({ boardId: BOARD_ID, userId: MEMBER_USER_ID, role: 'editor' }),
      ).rejects.toBe(connectionFailure);
    });
  });

  describe('updateRole', () => {
    it('меняет роль ТОЛЬКО под owner-only scope (атомарно, без отдельной проверки владения)', async () => {
      const { boardMemberRepository, update } = createDependencies();
      update.mockResolvedValue({});

      await boardMemberRepository.updateRole(BOARD_ID, OWNER_ID, MEMBER_USER_ID, 'viewer');

      expect(update).toHaveBeenCalledWith({
        where: OWNER_MANAGED_WHERE,
        data: { role: 'viewer' },
        select: BOARD_MEMBER_SELECT,
      });
    });

    it('на несуществующее членство или чужую доску отдаёt null', async () => {
      const { boardMemberRepository, update } = createDependencies();
      update.mockRejectedValue(recordNotFound());

      await expect(
        boardMemberRepository.updateRole(BOARD_ID, OWNER_ID, MEMBER_USER_ID, 'viewer'),
      ).resolves.toBeNull();
    });

    it('пробрасывает любую другую ошибку БД', async () => {
      const { boardMemberRepository, update } = createDependencies();
      const connectionFailure = new Error('connection terminated');
      update.mockRejectedValue(connectionFailure);

      await expect(
        boardMemberRepository.updateRole(BOARD_ID, OWNER_ID, MEMBER_USER_ID, 'viewer'),
      ).rejects.toBe(connectionFailure);
    });
  });

  describe('remove', () => {
    it('удаляет ТОЛЬКО под owner-only scope', async () => {
      const { boardMemberRepository, deleteMember } = createDependencies();
      deleteMember.mockResolvedValue({ id: 'member-id' });

      await expect(boardMemberRepository.remove(BOARD_ID, OWNER_ID, MEMBER_USER_ID)).resolves.toBe(
        true,
      );

      expect(deleteMember).toHaveBeenCalledWith({
        where: OWNER_MANAGED_WHERE,
        select: { id: true },
      });
    });

    it('на несуществующее членство или чужую доску отдаёт false', async () => {
      const { boardMemberRepository, deleteMember } = createDependencies();
      deleteMember.mockRejectedValue(recordNotFound());

      await expect(boardMemberRepository.remove(BOARD_ID, OWNER_ID, MEMBER_USER_ID)).resolves.toBe(
        false,
      );
    });
  });

  describe('findMembersAccessible', () => {
    it('читает участников через access-scoped запрос к доске', async () => {
      const { boardMemberRepository, findFirst } = createDependencies();
      findFirst.mockResolvedValue({ members: [] });

      await boardMemberRepository.findMembersAccessible(BOARD_ID, MEMBER_USER_ID);

      expect(findFirst).toHaveBeenCalledWith({
        where: ACCESS_SCOPED_WHERE,
        select: { members: { select: BOARD_MEMBER_SELECT, orderBy: { createdAt: 'asc' } } },
      });
    });

    it('на недоступную доску отдаёт null, на доску без участников — пустой массив', async () => {
      const { boardMemberRepository, findFirst } = createDependencies();

      findFirst.mockResolvedValue(null);
      await expect(
        boardMemberRepository.findMembersAccessible(BOARD_ID, MEMBER_USER_ID),
      ).resolves.toBeNull();

      findFirst.mockResolvedValue({ members: [] });
      await expect(
        boardMemberRepository.findMembersAccessible(BOARD_ID, MEMBER_USER_ID),
      ).resolves.toEqual([]);
    });
  });
});
