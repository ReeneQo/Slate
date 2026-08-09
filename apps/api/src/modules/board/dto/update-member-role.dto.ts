import { BoardMemberRole } from '@slate/database';
import { type AssertExact, type ExactKeys, type UpdateMemberRoleInput } from '@slate/shared-types';
import { IsEnum } from 'class-validator';

/**
 * Вход `PATCH /boards/:id/members/:userId` — сменить роль участника.
 *
 * `role` ОБЯЗАТЕЛЕН, хотя метод PATCH: у членства ровно одно изменяемое поле, и запрос без него —
 * это запрос, который ничего не меняет (та же логика, что у UpdateBoardDto, SLT-19).
 */
export class UpdateMemberRoleDto implements UpdateMemberRoleInput {
  @IsEnum(BoardMemberRole)
  role!: BoardMemberRole;
}

/** Сверка на лишние поля класса — см. пояснение в create-board.dto. */
export type _UpdateMemberRoleDtoKeys = AssertExact<
  ExactKeys<keyof UpdateMemberRoleDto, keyof UpdateMemberRoleInput>
>;
