import { BoardMemberRole } from '@slate/database';
import { type AssertExact, type ExactKeys, type InviteMemberInput } from '@slate/shared-types';
import { IsEmail, IsEnum } from 'class-validator';

/**
 * Вход `POST /boards/:id/members` — пригласить существующего пользователя по email.
 *
 * `email`, а не «identifier» (SLT-42, решение 1): сегодня приглашение работает только по email,
 * резолв в userId — отдельный шаг сервиса (`BoardMemberService.resolveInvitee`), не инлайн здесь.
 * Когда появится username-шеринг (реестр), это поле останется, а рядом точечно добавится
 * `username?` — без спекулятивного объединения двух способов адресации уже сейчас (YAGNI).
 *
 * `@IsEnum(BoardMemberRole)` — от РАНТАЙМ-объекта из @slate/database, как `type` в
 * UpsertElementDto: свой union в контракте разъехался бы с Prisma-enum'ом молча, добавь кто-то
 * третью роль в схему. `owner` в этом enum'е нет и быть не может — приглашение владельцем
 * запрещено уже на уровне типа (owner не строка `BoardMember`, см. board-member.types.ts).
 */
export class InviteMemberDto implements InviteMemberInput {
  @IsEmail({}, { message: 'Некорректный email' })
  email!: string;

  @IsEnum(BoardMemberRole)
  role!: BoardMemberRole;
}

/** Сверка на лишние поля класса — см. пояснение в create-board.dto. */
export type _InviteMemberDtoKeys = AssertExact<
  ExactKeys<keyof InviteMemberDto, keyof InviteMemberInput>
>;
