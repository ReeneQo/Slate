import { ConflictException, NotFoundException } from '@nestjs/common';

import type { SafeUser } from '../user/entities/user.entity';
import type { UserService } from '../user/user.service';
import type { AccessLevel } from './board.access';
import type { BoardService } from './board.service';
import type { BoardMemberRepository } from './board-member.repository';
import { BoardMemberService } from './board-member.service';
import type { BoardMemberDto } from './dto/board-member.dto';
import type { BoardMemberEntity } from './entities/board-member.entity';

const OWNER_ID = '019fa40d-6841-70ed-8b1d-7c64e6411bd6';
const INVITEE_ID = '019fa40d-9c2f-7b41-a8e5-3f1d0b7c22aa';
const BOARD_ID = '019fa5b1-0000-7000-8000-000000000001';
const MEMBER_ROW_ID = '019fa5b1-0000-7000-8000-000000000009';
const EMAIL = 'boris@example.test';
const CREATED_AT = new Date('2026-07-30T12:00:00.000Z');

function createSafeUser(overrides: Partial<SafeUser> = {}): SafeUser {
  return {
    id: INVITEE_ID,
    email: EMAIL,
    displayName: 'Boris',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createMemberEntity(overrides: Partial<BoardMemberEntity> = {}): BoardMemberEntity {
  return {
    id: MEMBER_ROW_ID,
    role: 'editor',
    createdAt: CREATED_AT,
    user: { id: INVITEE_ID, email: EMAIL, displayName: 'Boris' },
    ...overrides,
  };
}

const expectedMemberDto: BoardMemberDto = {
  id: MEMBER_ROW_ID,
  role: 'editor',
  createdAt: CREATED_AT,
  user: { id: INVITEE_ID, email: EMAIL, displayName: 'Boris' },
};

function createDependencies() {
  const create = jest.fn() as jest.MockedFunction<BoardMemberRepository['create']>;
  const updateRole = jest.fn() as jest.MockedFunction<BoardMemberRepository['updateRole']>;
  const remove = jest.fn() as jest.MockedFunction<BoardMemberRepository['remove']>;
  const findMembersAccessible = jest.fn() as jest.MockedFunction<
    BoardMemberRepository['findMembersAccessible']
  >;
  const getAccess = jest.fn() as jest.MockedFunction<BoardService['getAccess']>;
  const findByEmail = jest.fn() as jest.MockedFunction<UserService['findByEmail']>;

  const boardMemberRepository = {
    create,
    updateRole,
    remove,
    findMembersAccessible,
  } satisfies Record<keyof BoardMemberRepository, unknown>;

  const boardService = { getAccess } as unknown as BoardService;
  const userService = { findByEmail } as unknown as UserService;

  return {
    boardMemberService: new BoardMemberService(
      boardMemberRepository as unknown as BoardMemberRepository,
      boardService,
      userService,
    ),
    create,
    updateRole,
    remove,
    findMembersAccessible,
    getAccess,
    findByEmail,
  };
}

describe('BoardMemberService', () => {
  describe('list', () => {
    it('отдаёт участников, когда доска доступна (owner∪editor∪viewer)', async () => {
      const { boardMemberService, findMembersAccessible } = createDependencies();
      findMembersAccessible.mockResolvedValue([createMemberEntity()]);

      const result = await boardMemberService.list(BOARD_ID, INVITEE_ID);

      expect(findMembersAccessible).toHaveBeenCalledWith(BOARD_ID, INVITEE_ID);
      expect(result).toEqual([expectedMemberDto]);
    });

    it('на недоступную доску отвечает 404', async () => {
      const { boardMemberService, findMembersAccessible } = createDependencies();
      findMembersAccessible.mockResolvedValue(null);

      await expect(boardMemberService.list(BOARD_ID, INVITEE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('invite', () => {
    it('приглашает существующего пользователя по email', async () => {
      const { boardMemberService, getAccess, findByEmail, create } = createDependencies();
      getAccess.mockResolvedValue('owner');
      findByEmail.mockResolvedValue(createSafeUser());
      create.mockResolvedValue({ status: 'created', member: createMemberEntity() });

      const result = await boardMemberService.invite(BOARD_ID, OWNER_ID, {
        email: EMAIL,
        role: 'editor',
      });

      expect(getAccess).toHaveBeenCalledWith(BOARD_ID, OWNER_ID);
      expect(findByEmail).toHaveBeenCalledWith(EMAIL);
      expect(create).toHaveBeenCalledWith({
        boardId: BOARD_ID,
        userId: INVITEE_ID,
        role: 'editor',
      });
      expect(result).toEqual(expectedMemberDto);
    });

    it.each<AccessLevel>(['editor', 'viewer', null])(
      'не-owner (%s) получает 404, а не 403 — граница SLT-41 для управления шерингом',
      async (access) => {
        const { boardMemberService, getAccess, findByEmail } = createDependencies();
        getAccess.mockResolvedValue(access);

        await expect(
          boardMemberService.invite(BOARD_ID, OWNER_ID, { email: EMAIL, role: 'editor' }),
        ).rejects.toBeInstanceOf(NotFoundException);
        // Резолв email не должен произойти раньше проверки владения — иначе посторонний мог бы
        // перебором email узнавать, существуют ли аккаунты, даже не имея прав на доску.
        expect(findByEmail).not.toHaveBeenCalled();
      },
    );

    it('несуществующий email → 404', async () => {
      const { boardMemberService, getAccess, findByEmail } = createDependencies();
      getAccess.mockResolvedValue('owner');
      findByEmail.mockResolvedValue(null);

      await expect(
        boardMemberService.invite(BOARD_ID, OWNER_ID, { email: EMAIL, role: 'editor' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('само-приглашение owner → 409', async () => {
      const { boardMemberService, getAccess, findByEmail, create } = createDependencies();
      getAccess.mockResolvedValue('owner');
      findByEmail.mockResolvedValue(createSafeUser({ id: OWNER_ID }));

      await expect(
        boardMemberService.invite(BOARD_ID, OWNER_ID, { email: EMAIL, role: 'editor' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(create).not.toHaveBeenCalled();
    });

    it('дубль (уже участник) → 409', async () => {
      const { boardMemberService, getAccess, findByEmail, create } = createDependencies();
      getAccess.mockResolvedValue('owner');
      findByEmail.mockResolvedValue(createSafeUser());
      create.mockResolvedValue({ status: 'already-member' });

      await expect(
        boardMemberService.invite(BOARD_ID, OWNER_ID, { email: EMAIL, role: 'editor' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('доску удалили между проверкой владения и вставкой → 404', async () => {
      const { boardMemberService, getAccess, findByEmail, create } = createDependencies();
      getAccess.mockResolvedValue('owner');
      findByEmail.mockResolvedValue(createSafeUser());
      create.mockResolvedValue({ status: 'board-missing' });

      await expect(
        boardMemberService.invite(BOARD_ID, OWNER_ID, { email: EMAIL, role: 'editor' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateRole', () => {
    it('owner меняет роль участника', async () => {
      const { boardMemberService, getAccess, updateRole } = createDependencies();
      getAccess.mockResolvedValue('owner');
      updateRole.mockResolvedValue(createMemberEntity({ role: 'viewer' }));

      const result = await boardMemberService.updateRole(BOARD_ID, OWNER_ID, INVITEE_ID, {
        role: 'viewer',
      });

      expect(updateRole).toHaveBeenCalledWith(BOARD_ID, OWNER_ID, INVITEE_ID, 'viewer');
      expect(result).toEqual({ ...expectedMemberDto, role: 'viewer' });
    });

    it('не-owner получает 404', async () => {
      const { boardMemberService, getAccess } = createDependencies();
      getAccess.mockResolvedValue('editor');

      await expect(
        boardMemberService.updateRole(BOARD_ID, OWNER_ID, INVITEE_ID, { role: 'viewer' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('несуществующее членство → 404', async () => {
      const { boardMemberService, getAccess, updateRole } = createDependencies();
      getAccess.mockResolvedValue('owner');
      updateRole.mockResolvedValue(null);

      await expect(
        boardMemberService.updateRole(BOARD_ID, OWNER_ID, INVITEE_ID, { role: 'viewer' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('owner отзывает участника', async () => {
      const { boardMemberService, getAccess, remove } = createDependencies();
      getAccess.mockResolvedValue('owner');
      remove.mockResolvedValue(true);

      await expect(
        boardMemberService.remove(BOARD_ID, OWNER_ID, INVITEE_ID),
      ).resolves.toBeUndefined();
      expect(remove).toHaveBeenCalledWith(BOARD_ID, OWNER_ID, INVITEE_ID);
    });

    it('не-owner получает 404', async () => {
      const { boardMemberService, getAccess, remove } = createDependencies();
      getAccess.mockResolvedValue('viewer');

      await expect(
        boardMemberService.remove(BOARD_ID, OWNER_ID, INVITEE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(remove).not.toHaveBeenCalled();
    });

    it('несуществующее членство (в т.ч. userId владельца — он не member) → 404', async () => {
      const { boardMemberService, getAccess, remove } = createDependencies();
      getAccess.mockResolvedValue('owner');
      remove.mockResolvedValue(false);

      await expect(boardMemberService.remove(BOARD_ID, OWNER_ID, OWNER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
