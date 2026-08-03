import { type ReactElement, useState } from 'react';

import type { Board } from '@/entities/board';

import { mapBoardListError, mapBoardMutationError } from '../lib/mapBoardError';
import { useBoards } from '../model/useBoards';
import { useDeleteBoard } from '../model/useDeleteBoard';
import { BoardCard } from './BoardCard';
import { BoardListSkeleton } from './BoardListSkeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { CreateBoardForm } from './CreateBoardForm';

/**
 * Экран «Мои доски»: создание сверху, ниже — список с тремя обязательными состояниями
 * (loading / empty / error). Первая react-query-фича приложения.
 *
 * Удаление держит подтверждение в ЛОКАЛЬНОМ `boardToDelete` (какую доску подтверждаем), а не в
 * сторе/кэше: это эфемерное состояние экрана, живёт ровно пока открыт диалог. Мутацию сбрасываем
 * (`reset`) при открытии/отмене, чтобы ошибка прошлой попытки не «переехала» на другую доску.
 */
export function BoardList(): ReactElement {
  const { data: boards, isPending, isError, error, refetch } = useBoards();
  const deleteBoard = useDeleteBoard();
  const [boardToDelete, setBoardToDelete] = useState<Board | null>(null);

  const openDeleteDialog = (board: Board): void => {
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
        <ul className="flex flex-col gap-3">
          {boards.map((board) => (
            <BoardCard key={board.id} board={board} onDelete={openDeleteDialog} />
          ))}
        </ul>
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
