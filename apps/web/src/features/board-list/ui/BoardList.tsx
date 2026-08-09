import { type ReactElement, useState } from 'react';

import type { BoardListItem } from '@/entities/board';

import { groupBoards } from '../lib/groupBoards';
import { mapBoardListError, mapBoardMutationError } from '../lib/mapBoardError';
import { useBoards } from '../model/useBoards';
import { useDeleteBoard } from '../model/useDeleteBoard';
import { BoardCard } from './BoardCard';
import { BoardListSkeleton } from './BoardListSkeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { CreateBoardForm } from './CreateBoardForm';

interface BoardListProps {
  /** Открыть диалог шеринга для доски (SLT-43). Владеет им widgets/boards-dashboard — board-list
   * не может импортировать features/board-sharing напрямую (fsd-граница feature→feature). */
  onShare: (board: BoardListItem) => void;
}

/**
 * Экран «Мои доски»: создание сверху, ниже — список с тремя обязательными состояниями
 * (loading / empty / error). Список сгруппирован секциями «Мои доски» / «Доступные мне»
 * (SLT-43, решение 4) — `groupBoards` по `role` из `GET /boards` (owned ∪ shared, SLT-42).
 *
 * Удаление держит подтверждение в ЛОКАЛЬНОМ `boardToDelete` (какую доску подтверждаем), а не в
 * сторе/кэше: это эфемерное состояние экрана, живёт ровно пока открыт диалог. Мутацию сбрасываем
 * (`reset`) при открытии/отмене, чтобы ошибка прошлой попытки не «переехала» на другую доску.
 */
export function BoardList({ onShare }: BoardListProps): ReactElement {
  const { data: boards, isPending, isError, error, refetch } = useBoards();
  const deleteBoard = useDeleteBoard();
  const [boardToDelete, setBoardToDelete] = useState<BoardListItem | null>(null);

  const openDeleteDialog = (board: BoardListItem): void => {
    deleteBoard.reset();
    setBoardToDelete(board);
  };

  const closeDeleteDialog = (): void => {
    setBoardToDelete(null);
    deleteBoard.reset();
  };

  const confirmDelete = (): void => {
    if (!boardToDelete) return;
    deleteBoard.mutate(boardToDelete.id, {
      // Успех закрывает диалог; ошибка ОСТАВЛЯЕТ его открытым — текст покажется внутри (error prop).
      onSuccess: () => setBoardToDelete(null),
    });
  };

  return (
    <section aria-labelledby="boards-heading">
      <h1 id="boards-heading" className="mb-5 text-2xl font-semibold text-[#272d36]">
        Мои доски
      </h1>

      <CreateBoardForm />

      {isPending && (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загрузка досок…</span>
          <BoardListSkeleton />
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700"
        >
          <p>{mapBoardListError(error)}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-lg border border-red-300 px-4 py-2 font-medium transition-colors hover:bg-red-100"
          >
            Повторить
          </button>
        </div>
      )}

      {!isPending && !isError && boards.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/15 p-10 text-center">
          <p className="font-medium text-[#272d36]">Пока нет ни одной доски</p>
          <p className="mt-1 text-sm text-[#272d36]/60">Создайте первую — поле и кнопка выше.</p>
        </div>
      )}

      {!isPending && !isError && boards.length > 0 && (
        <BoardSections boards={boards} onDelete={openDeleteDialog} onShare={onShare} />
      )}

      <ConfirmDialog
        open={boardToDelete !== null}
        title="Удалить доску?"
        description={
          boardToDelete
            ? `Доска «${boardToDelete.title}» и её содержимое будут удалены безвозвратно.`
            : ''
        }
        confirmLabel="Удалить"
        busy={deleteBoard.isPending}
        error={deleteBoard.isError ? mapBoardMutationError(deleteBoard.error) : undefined}
        onConfirm={confirmDelete}
        onCancel={closeDeleteDialog}
      />
    </section>
  );
}

interface BoardSectionsProps {
  boards: BoardListItem[];
  onDelete: (board: BoardListItem) => void;
  onShare: (board: BoardListItem) => void;
}

/**
 * Секции «Мои доски» / «Доступные мне» (SLT-43, решение 4) — НЕ плоский список с бейджем.
 * Пустая shared-секция скрывается целиком (нечего группировать), пустая owned — не может
 * случиться, пока список непуст (единственный источник непустых элементов вне owned — shared,
 * а owned/shared уже разведены `groupBoards`), но условие держим симметричным на случай будущих
 * состояний (напр. юзер удалил все свои доски, оставив только shared).
 */
function BoardSections({ boards, onDelete, onShare }: BoardSectionsProps): ReactElement {
  const { owned, shared } = groupBoards(boards);

  return (
    <>
      {owned.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#272d36]/50">
            Мои доски
          </h2>
          <ul className="flex flex-col gap-3">
            {owned.map((board) => (
              <BoardCard key={board.id} board={board} onDelete={onDelete} onShare={onShare} />
            ))}
          </ul>
        </div>
      )}

      {shared.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#272d36]/50">
            Доступные мне
          </h2>
          <ul className="flex flex-col gap-3">
            {shared.map((board) => (
              <BoardCard key={board.id} board={board} onDelete={onDelete} onShare={onShare} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
