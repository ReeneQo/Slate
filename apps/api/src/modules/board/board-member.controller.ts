import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { Authorization } from '../../shared/decorators/authorization.decorator';
import { Authorized } from '../../shared/decorators/authorized.decorator';
import { BoardMemberService } from './board-member.service';
import type { BoardMemberDto } from './dto/board-member.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

/**
 * Транспорт шеринга (SLT-42): ни одного правила — все решения принимает `BoardMemberService`.
 *
 * Маршрут ВЛОЖЕННЫЙ (`boards/:boardId/members`), в отличие от плоского `/elements/:id`. У
 * элемента был свой аргумент против вложенности (глобально уникальный клиентский id, готовность
 * к WS-адресации без доски в пути) — у членства его нет: `BoardMember` не существует вне доски,
 * своего клиентского id не несёт, а управляется исключительно из контекста «эта доска, этот
 * участник» — ровно то, что и адресует вложенный путь.
 *
 * `:userId`, а не `:memberId` — участник в URL адресуется по ПОЛЬЗОВАТЕЛЮ, не по id строки
 * `BoardMember` (та у клиента и не запрошена нигде, кроме тела ответа, см. `boardMemberResponseSchema`).
 * Так DELETE/PATCH естественно читаются: «отозвать вот этого пользователя», а не «удалить строку
 * с таким служебным id».
 *
 * `@Authorization()` на классе, `ParseUUIDPipe` без версии (id — uuid v7) — тот же образец, что
 * у `BoardController`/`ElementController`.
 */
@Controller('boards/:boardId/members')
@Authorization()
export class BoardMemberController {
  constructor(private readonly boardMemberService: BoardMemberService) {}

  /** owner∪editor∪viewer — read, не управление (SLT-42, решение 2). */
  @Get()
  list(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Authorized('id') userId: string,
  ): Promise<BoardMemberDto[]> {
    return this.boardMemberService.list(boardId, userId);
  }

  /** owner-only. 201 — членство действительно создано. */
  @Post()
  invite(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Authorized('id') ownerUserId: string,
    @Body() dto: InviteMemberDto,
  ): Promise<BoardMemberDto> {
    return this.boardMemberService.invite(boardId, ownerUserId, dto);
  }

  /** owner-only. */
  @Patch(':userId')
  updateRole(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @Authorized('id') ownerUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<BoardMemberDto> {
    return this.boardMemberService.updateRole(boardId, ownerUserId, memberUserId, dto);
  }

  /** owner-only. 204 — как и у board/element: отдавать нечего. */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @Authorized('id') ownerUserId: string,
  ): Promise<void> {
    return this.boardMemberService.remove(boardId, ownerUserId, memberUserId);
  }
}
