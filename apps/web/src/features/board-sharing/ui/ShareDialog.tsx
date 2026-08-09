import type { BoardAccessRole } from '@slate/shared-types';
import { type ReactElement, useEffect, useRef } from 'react';

import { mapMemberListError } from '../lib/mapShareError';
import { getShareDialogAccess } from '../lib/shareAccess';
import { useBoardMembers } from '../model/useBoardMembers';
import { InviteForm } from './InviteForm';
import { MemberList } from './MemberList';

interface ShareDialogProps {
  boardId: string;
  /**
   * Роль ТЕКУЩЕГО пользователя на этой доске — решает, что показать (`getShareDialogAccess`).
   * Названо `accessRole`, а не `role`: на JSX-элементе `role` — ARIA-атрибут, и eslint-plugin-
   * jsx-a11y (aria-role) реагирует на само имя пропа независимо от типа компонента.
   */
  accessRole: BoardAccessRole;
  open: boolean;
  onClose: () => void;
}

/**
 * Диалог шеринга (SLT-43, решение 3) — нативный `<dialog>` + `showModal()`, тот же приём, что у
 * `ConfirmDialog` (features/board-list): фокус-трэп, Escape, `::backdrop` бесплатно от браузера.
 *
 * Доступ по роли — `getShareDialogAccess` (ЧИСТАЯ функция, юнит-тест на неё, не на разметку):
 *  - `full` (owner) — форма приглашения + строка «Владелец — Вы» + список участников с управлением;
 *  - `readonly` (editor) — только список участников, без управления, без строки владельца
 *    (API не отдаёт `ownerId` — кто владелец, editor'у не сообщается, см. `MemberList`);
 *  - `none` (viewer) — диалог не рендерит содержимое и принудительно не открывается: вызывающие
 *    (BoardCard, BoardCanvas) и так не показывают точку входа viewer'у, это защита от гонки роли.
 *
 * Список участников грузится ТОЛЬКО пока диалог открыт (`enabled: open` в useBoardMembers) —
 * не на каждый рендер родителя, а on-demand.
 */
export function ShareDialog({
  boardId,
  accessRole,
  open,
  onClose,
}: ShareDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const access = getShareDialogAccess(accessRole);
  const isOpen = open && access !== 'none';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const members = useBoardMembers(boardId, isOpen);
  // Пока запрос не запущен (диалог закрыт, enabled: false) query в состоянии pending — крутилку
  // не показываем, isOpen решает, монтировать ли содержимое вообще.
  const showLoading = isOpen && members.isPending;
  const showError = isOpen && members.isError;
  const showList = isOpen && !members.isPending && !members.isError;

  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-labelledby="share-dialog-title"
      className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 text-[#272d36] shadow-xl backdrop:bg-black/40"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="share-dialog-title" className="text-lg font-semibold">
          Участники доски
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="rounded-lg px-2 py-1 text-sm text-[#272d36]/60 transition-colors hover:bg-black/5"
        >
          ✕
        </button>
      </div>

      {isOpen && (
        <>
          {access === 'full' && (
            <>
              <InviteForm boardId={boardId} />
              <p className="mb-3 rounded-lg border border-black/10 px-3 py-2 text-sm text-[#272d36]/70">
                Владелец — Вы
              </p>
            </>
          )}

          {showLoading && (
            <p
              role="status"
              aria-live="polite"
              className="py-4 text-center text-sm text-[#272d36]/60"
            >
              Загрузка участников…
            </p>
          )}

          {showError && (
            <p role="alert" className="py-4 text-center text-sm text-red-600">
              {mapMemberListError(members.error)}
            </p>
          )}

          {showList && <MemberList boardId={boardId} members={members.data} access={access} />}
        </>
      )}
    </dialog>
  );
}
