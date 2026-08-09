import type { BoardAccessRole } from '@slate/shared-types';

/**
 * Доступ к диалогу шеринга по роли (SLT-43, решение 3):
 *  - `full` — owner: приглашение + список участников + управление ролями/отзыв;
 *  - `readonly` — editor: только список участников, без управления;
 *  - `none` — viewer: диалог не открывается вовсе.
 *
 * ЧИСТАЯ функция, а не разбросанные `role === 'owner'` по JSX ShareDialog: одна точка решения,
 * дальше компонент лишь рендерит по трём веткам (owner/editor уже не может «подглядеть» чужую
 * ветку опечаткой в условии).
 */
export type ShareDialogAccess = 'full' | 'readonly' | 'none';

export function getShareDialogAccess(role: BoardAccessRole): ShareDialogAccess {
  switch (role) {
    case 'owner':
      return 'full';
    case 'editor':
      return 'readonly';
    case 'viewer':
      return 'none';
  }
}
