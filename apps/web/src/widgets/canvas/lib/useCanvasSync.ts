import { useCallback, useEffect, useState } from 'react';

import {
  deleteElement,
  type DocumentChange,
  getBoardElements,
  patchElement,
  putElement,
  setDocumentChangeListener,
  useDocumentStore,
} from '@/entities/canvas-element';
import { isApiError } from '@/shared/api';

/**
 * Оркестратор синхронизации холста с бэком (SLT-27). Живёт в widgets/canvas, потому что знает
 * boardId из роута и координирует два процесса уровня виджета:
 *
 *  1. Гидрация — при открытии доски GET /boards/:id/elements → в document-store (без autosave-
 *     петли: hydrate НЕ уведомляет слушателя). reset при открытии И при размонтировании, чтобы не
 *     утащить элементы доски A в доску B.
 *  2. Autosave — подписка на семантические изменения document-store. Метод из намерения экшена:
 *     create → PUT, update → PATCH, delete → DELETE (не diff состояния).
 *
 * Поток ОДНОСТОРОННИЙ: store → сервер + стартовая гидрация. Ответы мутаций не применяются к стору
 * (стор — источник правды рендера; realtime сервер→клиент — этап 3).
 */

/** Статус первичной загрузки доски. */
export type HydrationStatus = 'loading' | 'ready' | 'error';

export interface CanvasSyncState {
  hydration: HydrationStatus;
  /**
   * Активна проблема сохранения (autosave не долетает). Персистентна: висит, пока очередное
   * сохранение снова не пройдёт. Данные при этом НЕ теряются — стор не откатывается.
   */
  hasSaveError: boolean;
  /** Повторить гидрацию после ошибки загрузки (кнопка «Повторить»). */
  retryHydration: () => void;
}

export function useCanvasSync(boardId: string): CanvasSyncState {
  const [hydration, setHydration] = useState<HydrationStatus>('loading');
  const [hasSaveError, setHasSaveError] = useState(false);
  // Смена значения перезапускает эффект гидрации — так работает «Повторить».
  const [reloadToken, setReloadToken] = useState(0);

  const retryHydration = useCallback(() => setReloadToken((token) => token + 1), []);

  // --- Гидрация + reset жизненного цикла доски -------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    const { reset, hydrate } = useDocumentStore.getState();

    // Открываем доску с чистого листа — прежняя доска не должна протечь.
    reset();
    setHydration('loading');
    setHasSaveError(false);

    getBoardElements(boardId, controller.signal)
      .then((elements) => {
        if (controller.signal.aborted) return;
        hydrate(elements);
        setHydration('ready');
      })
      .catch((error: unknown) => {
        // Отмена (уход с доски) — не ошибка.
        if (controller.signal.aborted) return;
        // 401 разрулит глобальный обработчик (SLT-25 сбросит auth и уведёт на логин).
        if (isApiError(error) && error.status === 401) return;
        setHydration('error');
      });

    return () => {
      controller.abort();
      // reset и на размонтировании: следующий монтаж (другая доска) начнёт с пустого документа.
      useDocumentStore.getState().reset();
    };
  }, [boardId, reloadToken]);

  // --- Autosave: подписка на семантические изменения -------------------------------------------
  useEffect(() => {
    const handleChange = (change: DocumentChange): void => {
      void save(change, boardId, setHasSaveError);
    };

    setDocumentChangeListener(handleChange);
    return () => setDocumentChangeListener(null);
  }, [boardId]);

  return { hydration, hasSaveError, retryHydration };
}

/**
 * Отправляет одно изменение на бэк и ведёт флаг ошибки сохранения.
 *
 * Частота (SLT-27 Р4): каждый экшен ДИСКРЕТЕН — commit по mouseup, update по Konva dragEnd, delete
 * по клавише. Один жест = один экшен = один запрос, поэтому debounce НЕ нужен. Появится потоковый
 * экшен (ресайз/поворот через Transformer, дёргающий update покадрово) — тогда и добавить debounce
 * с flush на завершении жеста, не раньше.
 *
 * Ошибка (Р9): локальное состояние НЕ откатываем — юзер видит фигуру, она просто не улетела.
 * Ставим персистентный флаг (баннер), успех любого следующего сохранения его снимает.
 */
async function save(
  change: DocumentChange,
  boardId: string,
  setHasSaveError: (value: boolean) => void,
): Promise<void> {
  try {
    switch (change.type) {
      case 'create':
        await putElement(change.element, boardId);
        break;
      case 'update':
        await patchElement(change.id, change.patch);
        break;
      case 'delete':
        // Одиночные операции (batch — SLT-22): удаление N элементов = N параллельных DELETE.
        await Promise.all(change.ids.map(deleteElement));
        break;
    }
    // Сохранение снова проходит — гасим баннер.
    setHasSaveError(false);
  } catch (error: unknown) {
    // 401 — не сетевая проблема сохранения, а истёкшая сессия: этим займётся глобальный обработчик.
    if (isApiError(error) && error.status === 401) return;
    setHasSaveError(true);
  }
}
