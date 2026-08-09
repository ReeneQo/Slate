import type { BoardMemberRole } from '@slate/shared-types';
import type { ReactElement } from 'react';

import type { BoardMember } from '@/entities/board';

import { mapMemberMutationError } from '../lib/mapShareError';
import type { ShareDialogAccess } from '../lib/shareAccess';
import { useRemoveMember } from '../model/useRemoveMember';
import { useUpdateMemberRole } from '../model/useUpdateMemberRole';

const ROLE_LABEL: Record<BoardMemberRole, string> = {
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

interface MemberListProps {
  boardId: string;
  members: BoardMember[];
  access: ShareDialogAccess;
}

/**
 * Список участников (SLT-42/43). `access === 'full'` (owner) — на каждой строке смена роли и
 * отзыв; `access === 'readonly'` (editor) — та же разметка, но без интерактива: editor видит,
 * КТО на доске, управлять не может (SLT-43, решение 3).
 *
 * Владелец сюда НЕ приходит (он не строка `BoardMember`, см. контракт SLT-42) — карточку
 * «Владелец — Вы» рисует `ShareDialog` отдельно, когда `access === 'full'` (в этом случае owner —
 * всегда текущий пользователь, имя брать неоткуда и не нужно). Для editor'а строки владельца
 * здесь нет вовсе: кто владелец, клиенту не сообщается (API не отдаёт `ownerId`, SLT-43 — вне
 * границ трогать бэк).
 */
export function MemberList({ boardId, members, access }: MemberListProps): ReactElement {
  const updateRole = useUpdateMemberRole(boardId);
  const removeMember = useRemoveMember(boardId);
  const canManage = access === 'full';

  if (members.length === 0) {
    return <p className="py-4 text-center text-sm text-[#272d36]/60">Пока нет участников</p>;
  }

  // Общая ошибка последней мутации на пачку строк — не per-row: 404 здесь (гонка, member уже
  // отозван/роль уже сменена в другой вкладке) скорее исключение, чем регулярный кейс, отдельный
  // текст под каждую строку избыточен (тот же принцип «минимально», что у SyncErrorBanner).
  const mutationError = updateRole.isError
    ? mapMemberMutationError(updateRole.error)
    : removeMember.isError
      ? mapMemberMutationError(removeMember.error)
      : null;

  return (
    <>
      {mutationError && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {mutationError}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isUpdatingThis =
            updateRole.isPending && updateRole.variables?.userId === member.user.id;
          const isRemovingThis =
            removeMember.isPending && removeMember.variables === member.user.id;

          return (
            <li
              key={member.id}
              className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#272d36]">
                  {member.user.displayName}
                </p>
                <p className="truncate text-xs text-[#272d36]/60">{member.user.email}</p>
              </div>

              {canManage ? (
                <>
                  <label className="sr-only" htmlFor={`role-${member.id}`}>
                    Роль {member.user.displayName}
                  </label>
                  <select
                    id={`role-${member.id}`}
                    value={member.role}
                    disabled={isUpdatingThis || isRemovingThis}
                    onChange={(event) =>
                      updateRole.mutate({
                        userId: member.user.id,
                        input: { role: event.target.value as BoardMemberRole },
                      })
                    }
                    className="shrink-0 rounded-lg border border-black/15 px-2 py-1 text-sm text-[#272d36] outline-none focus:border-[#c2613d] disabled:opacity-60"
                  >
                    <option value="editor">Редактор</option>
                    <option value="viewer">Наблюдатель</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeMember.mutate(member.user.id)}
                    disabled={isUpdatingThis || isRemovingThis}
                    aria-label={`Отозвать доступ у ${member.user.displayName}`}
                    className="shrink-0 rounded-lg border border-black/15 px-2 py-1 text-sm font-medium text-[#272d36] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                  >
                    Отозвать
                  </button>
                </>
              ) : (
                <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-[#272d36]/70">
                  {ROLE_LABEL[member.role]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
