import { useCallback, useEffect, useState } from 'react';

import {
  type CanvasElement,
  type DocumentChange,
  getBoardElements,
  setDocumentChangeListener,
  toUpsertInput,
  useDocumentStore,
} from '@/entities/canvas-element';
import {
  type AppSocket,
  type ElementBroadcastPayload,
  type ElementCreateAckResult,
  type ElementCreatePayload,
  type ElementDeleteAckResult,
  type ElementDeletedBroadcastPayload,
  type ElementDeletePayload,
  type ElementUpdateAckResult,
  type ElementUpdatePayload,
  useRealtimeStore,
} from '@/features/realtime-presence';
import { isApiError } from '@/shared/api';

/**
 * Оркестратор синхронизации холста с бэком (SLT-27, транспорт мутаций — WS с SLT-39). Живёт в
 * widgets/canvas, потому что знает boardId из роута и координирует ТРИ процесса уровня виджета:
 *
 *  1. Гидрация — при открытии доски GET /boards/:id/elements → в document-store (без autosave-
 *     петли: hydrate НЕ уведомляет слушателя). reset при открытии И при размонтировании, чтобы не
 *     утащить элементы доски A в доску B. Остаётся HTTP — гидрация не мутация (SLT-39 Р2).
 *  2. Autosave (свои мутации) — подписка на семантические изменения document-store. Метод из
 *     намерения экшена: create/update/delete → element_create/update/delete по WS с ack, а не
 *     HTTP PUT/PATCH/DELETE (SLT-39 Р1: замена транспорта, не механики — debounce/баннер из
 *     SLT-27 не меняются).
 *  3. Remote-sync (чужие мутации, НОВОЕ в SLT-39) — подписка на element_created/updated/deleted
 *     от других участников комнаты → remote-actions document-store (applyRemoteCreate/Update/
 *     Delete). Эти actions НЕ уведомляют autosave-слушателя — физически другие функции, не флаг,
 *     поэтому чужое применённое не может случайно уйти обратно на сервер (SLT-39 Р4).
 *
 * Поток ДВУСТОРОННИЙ (с SLT-39): store → сервер (свои мутации + гидрация) И сервер → store
 * (чужие мутации). Анти-эхо не завязано на userId (ловушка двух вкладок одного юзера, Р3) —
 * целиком на socket.to на сервере (отправитель не получает свой же broadcast) и на remote-
 * actions на клиенте (применённое чужое не переотправляется).
 */

/** Статус первичной загрузки доски. */
export type HydrationStatus = 'loading' | 'ready' | 'error';

export interface CanvasSyncState {
  hydration: HydrationStatus;
  /**
   * Активна проблема сохранения (своя мутация не долетела или была отклонена сервером). Персис-
   * тентна: висит, пока очередное сохранение снова не пройдёт. Данные при этом НЕ теряются —
   * стор не откатывается (в т.ч. на version_conflict — полноценный refetch-and-reapply — SLT-40).
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

  // --- Свои мутации: подписка на семантические изменения → WS-emit с ack (SLT-39) --------------
  useEffect(() => {
    const handleChange = (change: DocumentChange): void => {
      const socket = useRealtimeStore.getState().socket;
      void sendMutation(socket, change, boardId, setHasSaveError);
    };

    setDocumentChangeListener(handleChange);
    return () => setDocumentChangeListener(null);
  }, [boardId]);

  // --- Чужие мутации: подписка на broadcast → remote-actions документа (SLT-39) ----------------
  useEffect(() => {
    // Один сокет на приложение (features/realtime-presence, SLT-33/37): подключается при
    // переходе auth в authenticated, до открытия любой доски — к моменту монтирования канвас-
    // виджета он уже существует (тот же приём, что у useRealtimePresence/joinBoard).
    const socket = useRealtimeStore.getState().socket;
    if (!socket) return;

    const handleCreated = (payload: ElementBroadcastPayload): void => {
      useDocumentStore.getState().applyRemoteCreate(payload.element);
    };
    const handleUpdated = (payload: ElementBroadcastPayload): void => {
      useDocumentStore.getState().applyRemoteUpdate(payload.element);
    };
    const handleDeleted = (payload: ElementDeletedBroadcastPayload): void => {
      useDocumentStore.getState().applyRemoteDelete(payload.id);
    };

    socket.on('element_created', handleCreated);
    socket.on('element_updated', handleUpdated);
    socket.on('element_deleted', handleDeleted);

    return () => {
      socket.off('element_created', handleCreated);
      socket.off('element_updated', handleUpdated);
      socket.off('element_deleted', handleDeleted);
    };
  }, [boardId]);

  return { hydration, hasSaveError, retryHydration };
}

// --- WS-emit с ack: по одной функции на событие (см. joinBoard в realtime.store.ts — тот же
// приём, без générique-обёртки над socket.emit: у каждого события своя форма ack). ---------------

function emitElementCreate(
  socket: AppSocket,
  payload: ElementCreatePayload,
): Promise<ElementCreateAckResult> {
  return new Promise((resolve) => socket.emit('element_create', payload, resolve));
}

function emitElementUpdate(
  socket: AppSocket,
  payload: ElementUpdatePayload,
): Promise<ElementUpdateAckResult> {
  return new Promise((resolve) => socket.emit('element_update', payload, resolve));
}

function emitElementDelete(
  socket: AppSocket,
  payload: ElementDeletePayload,
): Promise<ElementDeleteAckResult> {
  return new Promise((resolve) => socket.emit('element_delete', payload, resolve));
}

/**
 * Отправляет одно семантическое изменение документа по WS и ведёт флаг ошибки сохранения
 * (замена HTTP-транспорта из SLT-27 на WS, SLT-39 Р1 — сама механика debounce/баннера не
 * меняется, дискретность действий та же: commit по mouseup, update по dragEnd, delete по клавише).
 *
 * `socket` — явный параметр, а не читается из стора внутри: тестируемость (см.
 * useCanvasSync.test.ts — фейковый socket с моком emit, без реального подключения) и явность
 * контракта, тот же приём, что и у прежнего save().
 *
 * Успех (ok:true) — тихо синхронизирует version элемента из ack через syncElementVersion. Это
 * ПОДТВЕРЖДЕНИЕ уже отправленного, а не новое изменение: не идёт через emitChange, иначе
 * подтверждение своей же правки само стало бы поводом для следующего autosave-запроса (Р4/Р5).
 *
 * Отказ (ok:false, включая version_conflict) — тот же персистентный баннер, что при сбое
 * autosave в SLT-27. Локальный стор НЕ трогаем и НЕ реаплаим актуальный элемент, который несёт
 * version_conflict, — это был бы refetch-and-reapply, отложенный на SLT-40 (Р1): здесь только
 * не даём отказу пройти незамеченным, иначе стор и сервер тихо разъедутся.
 */
export async function sendMutation(
  socket: AppSocket | null,
  change: DocumentChange,
  boardId: string,
  setHasSaveError: (value: boolean) => void,
): Promise<void> {
  if (!socket) {
    // Сокета нет (не подключен/разлогинен) — сохранить нечем, тот же сигнал, что явный reject.
    setHasSaveError(true);
    return;
  }

  const { syncElementVersion } = useDocumentStore.getState();
  let ok = false;

  switch (change.type) {
    case 'create': {
      const payload: ElementCreatePayload = buildCreatePayload(change.element, boardId);
      const result = await emitElementCreate(socket, payload);
      ok = result.ok;
      if (result.ok) syncElementVersion(change.element.id, result.element.version);
      break;
    }
    case 'update': {
      // version читаем из стора СЕЙЧАС (не из change): патч её не трогает, но обновиться она
      // могла с момента экшена — либо своим предыдущим ack (syncElementVersion), либо чужим
      // remote-update. Она же — та единственная точка, где хранится актуальное значение (Р5).
      const version = useDocumentStore.getState().elements[change.id]?.version ?? 0;
      const result = await emitElementUpdate(socket, {
        boardId,
        id: change.id,
        version,
        changes: change.patch,
      });
      ok = result.ok;
      if (result.ok) syncElementVersion(change.id, result.element.version);
      break;
    }
    case 'delete': {
      // Одиночные операции (batch — SLT-22): удаление N элементов = N параллельных
      // element_delete. version на КАЖДЫЙ уже снята в самом change (deleteElements успел убрать
      // элемент из стора раньше, чем сюда добралась асинхронная отправка — версию оттуда после
      // удаления читать поздно, поэтому она едет прямо в DocumentChange, см. document.store.ts).
      const results = await Promise.all(
        change.deletions.map(({ id, version }) =>
          emitElementDelete(socket, { boardId, id, version }),
        ),
      );
      ok = results.every((result) => result.ok);
      break;
    }
  }

  setHasSaveError(!ok);
}

/** Клиентский элемент → тело `element_create` (форма создания + id, см. realtime.contracts.ts). */
function buildCreatePayload(element: CanvasElement, boardId: string): ElementCreatePayload {
  return { ...toUpsertInput(element, boardId), id: element.id };
}
