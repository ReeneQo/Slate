import { type ReactElement, useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Идёт подтверждённое действие: блокируем кнопки и закрытие, чтобы не отменить на полпути. */
  busy?: boolean;
  /** Ошибка последней попытки действия — показываем прямо в диалоге, он остаётся открытым. */
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Модальное подтверждение на нативном `<dialog>` + `showModal()`. Нативный элемент выбран не для
 * краткости: он бесплатно даёт то, что руками на `<div>` пишется долго и ошибочно — перехват
 * фокуса внутри модалки, закрытие по Escape, инертность фона для скринридера и `::backdrop`.
 *
 * Escape перехватываем ('cancel') и уводим в `onCancel`, чтобы РОДИТЕЛЬ оставался единственным
 * владельцем флага `open` (иначе DOM закрыл бы диалог, а React думал бы, что он открыт —
 * рассинхрон). Во время `busy` закрытие подавляется: нельзя отменить удаление, которое уже ушло
 * на сервер.
 *
 * Закрытия по клику на фон намеренно НЕТ: для необратимого действия случайный клик мимо не должен
 * быть выходом, а клавиатурный путь (Escape + кнопка «Отмена») и так полон. Это и убирает
 * onClick с `<dialog>` — иначе jsx-a11y справедливо потребовал бы клавиатурный аналог там, где
 * его роль уже исполняет нативный Escape.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Императивно синхронизируем DOM-состояние диалога с пропом `open`: showModal/close нельзя
  // выразить декларативно, у `<dialog>` это методы.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>): void => {
    // Перехватываем нативное закрытие по Escape ('cancel'): решение принимает родитель.
    event.preventDefault();
    if (!busy) onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      className="max-w-sm rounded-2xl border border-black/10 bg-white p-6 text-[#272d36] shadow-xl backdrop:bg-black/40"
    >
      <h2 id="confirm-dialog-title" className="text-lg font-semibold">
        {title}
      </h2>
      <p id="confirm-dialog-description" className="mt-2 text-sm text-[#272d36]/70">
        {description}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? 'Удаление…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
