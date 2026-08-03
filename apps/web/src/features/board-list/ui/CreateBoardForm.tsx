import { zodResolver } from '@hookform/resolvers/zod';
import { BOARD_TITLE_MAX_LENGTH } from '@slate/shared-types';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { boardPath } from '@/shared/config';

import { mapBoardMutationError } from '../lib/mapBoardError';
import { useCreateBoard } from '../model/useCreateBoard';

/**
 * Схема формы, а НЕ `createBoardSchema` из контракта. Разница принципиальна: контракт запрещает
 * пустой title (`min(1)`), но в ФОРМЕ пустое поле — это законное «создай с дефолтом»: сервер
 * подставит «Untitled». Схема контракта роняла бы валидную операцию ошибкой. Проверяем здесь
 * только верхнюю границу (общий предел из пакета), а пустое → `undefined` на отправке.
 */
const createBoardFormSchema = z.object({
  title: z.string().max(BOARD_TITLE_MAX_LENGTH, `Не длиннее ${BOARD_TITLE_MAX_LENGTH} символов`),
});

type CreateBoardFormValues = z.infer<typeof createBoardFormSchema>;

/**
 * Форма создания доски: одно опциональное поле + кнопка. Владеет мутацией и навигацией —
 * самодостаточна, список её только размещает.
 *
 * После успеха переходим на холст новой доски (`boardPath`, пока заглушка SLT-27): создание
 * доски ради того, чтобы на ней рисовать, поэтому естественный следующий шаг — открыть её.
 * Инвалидацию списка делает сам хук; ошибку мутации кладём в `root` и показываем.
 */
export function CreateBoardForm(): ReactElement {
  const navigate = useNavigate();
  const createBoard = useCreateBoard();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateBoardFormValues>({
    resolver: zodResolver(createBoardFormSchema),
    defaultValues: { title: '' },
  });

  const onSubmit = handleSubmit((values) => {
    const title = values.title.trim();
    createBoard.mutate(
      { title: title === '' ? undefined : title },
      {
        onSuccess: (board) => void navigate(boardPath(board.id)),
        onError: (error) => setError('root', { message: mapBoardMutationError(error) }),
      },
    );
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="mb-6">
      <div className="flex gap-2">
        <input
          type="text"
          aria-label="Название новой доски"
          placeholder="Название доски (необязательно)"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'create-board-error' : undefined}
          className="min-w-0 flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-[#272d36] outline-none focus:border-[#c2613d]"
          {...register('title')}
        />
        <button
          type="submit"
          disabled={createBoard.isPending}
          className="shrink-0 rounded-lg bg-[#c2613d] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#a94f30] disabled:opacity-60"
        >
          {createBoard.isPending ? 'Создание…' : 'Создать доску'}
        </button>
      </div>
      {(errors.title ?? errors.root) && (
        <p id="create-board-error" role="alert" className="mt-1 text-sm text-red-600">
          {(errors.title ?? errors.root)?.message}
        </p>
      )}
    </form>
  );
}
