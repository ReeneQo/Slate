import type { BoardMemberRole } from '@slate/database';

import type { BoardMemberEntity } from '../entities/board-member.entity';

/**
 * Участник доски в ответе. `id` — id строки `BoardMember`, не пользователя: тот лежит в
 * `user.id`, и управление (PATCH/DELETE) адресуется по нему в URL, а не по этому полю (см.
 * докстринг `boardMemberResponseSchema` в @slate/shared-types — форма зеркалит контракт).
 *
 * `user` — узкий профиль (id/email/displayName), без `hasPassword`: чужой факт о пароле в списке
 * участников делать нечего.
 */
export interface BoardMemberDto {
  id: string;
  role: BoardMemberRole;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
}

/** Маппер сущность → DTO. Поля перечислены поимённо — та же страховка, что у toBoardDto/toElementDto. */
export function toBoardMemberDto(member: BoardMemberEntity): BoardMemberDto {
  return {
    id: member.id,
    role: member.role,
    createdAt: member.createdAt,
    user: {
      id: member.user.id,
      email: member.user.email,
      displayName: member.user.displayName,
    },
  };
}
