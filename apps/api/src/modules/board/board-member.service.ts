import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { SafeUser } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { boardNotFound, BoardService } from './board.service';
import { BoardMemberRepository } from './board-member.repository';
import { type BoardMemberDto, toBoardMemberDto } from './dto/board-member.dto';
import type { InviteMemberDto } from './dto/invite-member.dto';
import type { UpdateMemberRoleDto } from './dto/update-member-role.dto';

/**
 * Бизнес-логика шеринга (SLT-42). PrismaService не инжектит — в БД ходит только через
 * `BoardMemberRepository`. Владение доской (единственное условие управления) спрашивает не
 * напрямую у Prisma, а через `BoardService.getAccess` — тот же вход, которым уже пользуются
 * element-модуль и WS-join (SLT-41): второй независимой формулировки «кто владелец» в
 * приложении быть не должно.
 *
 * OWNER-ONLY ГЕЙТ управления (invite/updateRole/remove) устроен ТАК ЖЕ, как rename/delete доски
 * (SLT-41): не-owner (посторонний, editor, viewer) получает 404 `boardNotFound()`, а не 403.
 * Разница с `forbiddenWrite()` элементов не случайна: там 403 — это осознанная особая политика
 * для viewer'а, читающего элементы (см. докстринг `forbiddenWrite`), а здесь переиспользуется
 * УЖЕ ПРИНЯТОЕ решение SLT-41 — управление ЖИЗНЕННЫМ ЦИКЛОМ доски (а шеринг — часть него) владелец-
 * only и не различает «доски нет» от «ты не owner» даже для тех, кому доска видна на чтение.
 */
@Injectable()
export class BoardMemberService {
  constructor(
    private readonly boardMemberRepository: BoardMemberRepository,
    private readonly boardService: BoardService,
    private readonly userService: UserService,
  ) {}

  /**
   * Список участников. Доступен owner∪editor∪viewer — это read, не управление (SLT-42, решение
   * 2), поэтому здесь НЕТ owner-гейта: `findMembersAccessible` сам сужает выборку до
   * `accessibleBoardScope`, и посторонний получает `null` ⇒ 404 тем же путём, что везде в модуле.
   *
   * @throws {NotFoundException} доска не существует, либо недоступна вызывающему
   */
  async list(boardId: string, userId: string): Promise<BoardMemberDto[]> {
    const members = await this.boardMemberRepository.findMembersAccessible(boardId, userId);

    if (members === null) {
      throw boardNotFound();
    }

    return members.map((member) => toBoardMemberDto(member));
  }

  /**
   * Пригласить существующего пользователя по email.
   *
   * Порядок проверок важен: сначала владение (иначе посторонний перебором email узнавал бы о
   * существовании доски раньше, чем о существовании юзера), потом резолв приглашаемого, потом
   * само-приглашение, и только затем — запись.
   *
   * @throws {NotFoundException} доска недоступна/не существует ИЛИ вызывающий не owner ИЛИ email
   *   не зарегистрирован
   * @throws {ConflictException} приглашается сам owner, ИЛИ приглашаемый уже участник
   */
  async invite(
    boardId: string,
    ownerUserId: string,
    dto: InviteMemberDto,
  ): Promise<BoardMemberDto> {
    await this.assertOwner(boardId, ownerUserId);

    const invitee = await this.resolveInvitee(dto.email);

    // Владелец уже присутствует на доске неявно (Board.ownerId) — членство для него избыточно и
    // запрещено на уровне схемы (owner не строка BoardMember, SLT-42 решение 4).
    if (invitee.id === ownerUserId) {
      throw selfInviteConflict();
    }

    const outcome = await this.boardMemberRepository.create({
      boardId,
      userId: invitee.id,
      role: dto.role,
    });

    switch (outcome.status) {
      case 'created':
        return toBoardMemberDto(outcome.member);
      case 'already-member':
        throw alreadyMember();
      case 'board-missing':
        // Гонка: доску удалили между assertOwner и вставкой. Для клиента событие то же самое,
        // что «доски нет» — тот же текст, что и у остального модуля.
        throw boardNotFound();
    }
  }

  /**
   * Сменить роль участника.
   *
   * @throws {NotFoundException} вызывающий не owner (или доски нет), либо членства не существует
   */
  async updateRole(
    boardId: string,
    ownerUserId: string,
    memberUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<BoardMemberDto> {
    await this.assertOwner(boardId, ownerUserId);

    const member = await this.boardMemberRepository.updateRole(
      boardId,
      ownerUserId,
      memberUserId,
      dto.role,
    );

    if (member === null) {
      throw memberNotFound();
    }

    return toBoardMemberDto(member);
  }

  /**
   * Отозвать участника.
   *
   * @throws {NotFoundException} вызывающий не owner (или доски нет), либо членства не существует
   */
  async remove(boardId: string, ownerUserId: string, memberUserId: string): Promise<void> {
    await this.assertOwner(boardId, ownerUserId);

    const isRemoved = await this.boardMemberRepository.remove(boardId, ownerUserId, memberUserId);

    if (!isRemoved) {
      throw memberNotFound();
    }
  }

  /**
   * Владение доской — общий гейт для всех трёх операций управления. `boardNotFound()`, а не
   * отдельный 403: см. докстринг класса про то, почему это решение SLT-41, а не новое.
   */
  private async assertOwner(boardId: string, userId: string): Promise<void> {
    const access = await this.boardService.getAccess(boardId, userId);

    if (access !== 'owner') {
      throw boardNotFound();
    }
  }

  /**
   * Резолв приглашаемого — ОТДЕЛЬНЫЙ шаг, не инлайн email→userId в `invite` (SLT-42, решение 1).
   * Сегодня единственная ветка — email; когда появится username-шеринг (реестр), контракт
   * (`InviteMemberInput`) точечно получит `username?`, здесь добавится вторая ветка резолва
   * (email → findByEmail, username → findByUsername), а `invite()` тронет ровно один вызов —
   * `resolveInvitee(dto.email)` станет `resolveInvitee(dto)` — БЕЗ переписывания порядка проверок
   * (owner → резолв → self-invite → create) и без второй копии этой логики где-то ещё.
   *
   * @throws {NotFoundException} email не зарегистрирован. Раскрытие факта регистрации по email —
   *   принятый компромисс MVP (SLT-42, решение 1): шеринг предполагается между людьми, знающими
   *   email друг друга, это не публичный энумератор.
   */
  private async resolveInvitee(email: string): Promise<SafeUser> {
    const invitee = await this.userService.findByEmail(email);

    if (invitee === null) {
      throw inviteeNotFound();
    }

    return invitee;
  }
}

/** Приглашаемый email не зарегистрирован — pending-инвайты вне MVP (SLT-42, реестр). */
function inviteeNotFound(): NotFoundException {
  return new NotFoundException('Пользователь с таким email не найден');
}

/** Owner приглашает сам себя — он уже владелец, членство для него не заводится. */
function selfInviteConflict(): ConflictException {
  return new ConflictException('Нельзя пригласить самого себя — вы уже владелец доски');
}

/**
 * Приглашаемый уже участник доски. 409, а не молчаливый upsert (SLT-42, решение 4): для смены
 * роли есть `PATCH`, и повторный `POST` не должен тайком делать то же самое другим путём.
 */
function alreadyMember(): ConflictException {
  return new ConflictException('Пользователь уже участник доски');
}

/** PATCH/DELETE на несуществующее членство (в т.ч. на userId владельца — он не member). */
function memberNotFound(): NotFoundException {
  return new NotFoundException('Участник не найден');
}
