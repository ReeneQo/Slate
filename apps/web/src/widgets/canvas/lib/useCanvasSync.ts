import { useCallback, useEffect, useState } from 'react';

import {
  type CanvasElement,
  type DocumentChange,
  getBoardElements,
  setDocumentChangeListener,
  toUpsertInput,
  useDocumentStore,
  useHistoryStore,
} from '@/entities/canvas-element';
import {
  type AppSocket,
  type ElementBroadcastPayload,
  type ElementCreateAckResult,
  type ElementCreatePayload,
  type ElementDeleteAckResult,
  type ElementDeletedBroadcastPayload,
  type ElementDeletePayload,
  type ElementMutationRejectReason,
  type ElementUpdateAckResult,
  type ElementUpdatePayload,
  useRealtimeStore,
} from '@/features/realtime-presence';
import { isApiError } from '@/shared/api';

/**
 * Оркестратор синхронизации холста с бэком (SLT-27, транспорт мутаций — WS с SLT-39, разрешение
 * конфликтов — SLT-40). Живёт в widgets/canvas, потому что знает boardId из роута и координирует
 * ЧЕТЫРЕ процесса уровня виджета:
 *
 *  1. Гидрация — при открытии доски GET /boards/:id/elements → в document-store (без autosave-
 *     петли: hydrate НЕ уведомляет слушателя). reset при открытии И при размонтировании, чтобы не
 *     утащить элементы доски A в доску B. Остаётся HTTP — гидрация не мутация (SLT-39 Р2). Ответ
 *     несёт version (SLT-40 Р2) — фронт больше не дефолтит её в 0.
 *  2. Autosave (свои мутации) — подписка на семантические изменения document-store. Метод из
 *     намерения экшена: create/update/delete → element_create/update/delete по WS с ack, а не
 *     HTTP PUT/PATCH/DELETE (SLT-39 Р1). Отказ (SLT-40): version_conflict — last-write-wins,
 *     актуальный элемент из ack применяется в стор remote-путём, своя правка отбрасывается;
 *     прочие причины — персистентный баннер, стор не трогаем.
 *  3. Remote-sync (чужие мутации) — подписка на element_created/updated/deleted от других
 *     участников комнаты → remote-actions document-store. Эти actions НЕ уведомляют autosave-
 *     слушателя — физически другие функции, не флаг (SLT-39 Р4).
 *  4. Resync после reconnect (SLT-40 Р3) — на реконнект сокета (после реального обрыва, SLT-37
 *     уже делает re-join комнаты) повторная гидрация: полный refetch, БЕЗУСЛОВНАЯ замена стора
 *     серверным состоянием. Пока был оффлайн, клиент мог пропустить чужие broadcast-мутации —
 *     сервер здесь истина, локальные несохранённые правки НЕ спасаются (см. refetchDocument).
 *
 * Поток ДВУСТОРОННИЙ (с SLT-39): store → сервер (свои мутации + гидрация) И сервер → store
 * (чужие мутации, resync). Анти-эхо не завязано на userId — целиком на socket.to на сервере и на
 * remote-actions на клиенте.
 */

/** Статус первичной загрузки доски. */
export type HydrationStatus = 'loading' | 'ready' | 'error';

/**
 * Причина активного баннера сохранения (SLT-40, дополнено SLT-43): сеть/сервер, version-конфликт
 * и «доступ отозван» — три разных действия пользователя, три разных текста (см. SyncErrorBanner).
 * `forbidden` — свой отказ мутации (viewer-роль, SLT-41 `forbidden`): отдельно от `network`, чтобы
 * понижённый/отозванный участник видел «доступ изменён», а не «не удалось сохранить» (тот текст
 * подразумевает «повтори», а повтор здесь бессмысленен — сервер откажет снова, пока роль не
 * вернут). `null` — баннер скрыт.
 */
export type SaveErrorKind = 'network' | 'conflict' | 'forbidden';

export interface CanvasSyncState {
  hydration: HydrationStatus;
  /**
   * Активна проблема сохранения (своя мутация не долетела/была отклонена). Персистентна: висит,
   * пока очередное сохранение снова не пройдёт (или пока reconnect-resync её не снимет вместе с
   * заменой стора серверным состоянием). Данные при этом НЕ теряются молча — на version_conflict
   * стор синхронизирован с сервером (last-write-wins, SLT-40), своя отклонённая правка потеряна,
   * но заметно и с явным сообщением, не тихо.
   */
  saveError: SaveErrorKind | null;
  /** Повторить гидрацию после ошибки загрузки (кнопка «Повторить»). */
  retryHydration: () => void;
}

export function useCanvasSync(boardId: string): CanvasSyncState {
  const [hydration, setHydration] = useState<HydrationStatus>('loading');
  const [saveError, setSaveError] = useState<SaveErrorKind | null>(null);
  // Смена значения перезапускает эффект гидрации — так работает «Повторить».
  const [reloadToken, setReloadToken] = useState(0);

  const retryHydration = useCallback(() => setReloadToken((token) => token + 1), []);

  // --- Гидрация + reset жизненного цикла доски -------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();

    // Открываем доску с чистого листа — прежняя доска не должна протечь. История (SLT-65) сбрасывается
    // тем же приёмом: своя история одной доски не должна быть доступна для undo/redo на другой.
    useDocumentStore.getState().reset();
    useHistoryStore.getState().reset();
    setHydration('loading');
    setSaveError(null);

    refetchDocument(boardId, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
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
      // reset и на размонтировании: следующий монтаж (другая доска) начнёт с пустого документа
      // и пустой истории.
      useDocumentStore.getState().reset();
      useHistoryStore.getState().reset();
    };
  }, [boardId, reloadToken]);

  // --- Свои мутации: подписка на семантические изменения → WS-emit с ack (SLT-39/40) -----------
  useEffect(() => {
    const handleChange = (change: DocumentChange): void => {
      const socket = useRealtimeStore.getState().socket;
      void sendMutation(socket, change, boardId, setSaveError);
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

  // --- Resync после reconnect (SLT-40 Р3): полный refetch = replace, безусловно -----------------
  useEffect(() => {
    const socket = useRealtimeStore.getState().socket;
    if (!socket) return;

    const controller = new AbortController();

    // Manager-уровневое 'reconnect' (не 'connect' — тот стреляет и на первом подключении, см.
    // тот же приём в realtime.store.ts про re-join комнаты). Пока сокет был разорван, клиент мог
    // пропустить чужие broadcast-мутации — сервер здесь истина, локальный документ ЗАМЕНЯЕТСЯ
    // целиком, а не мержится (см. докстринг refetchDocument). Успешный resync снимает и баннер
    // сохранения — правка, из-за которой он загорелся, либо уже неактуальна (её перезаписал
    // сервер), либо (network-баннер) сеть уже восстановлена самим фактом reconnect.
    const handleReconnect = (): void => {
      refetchDocument(boardId, controller.signal)
        .then(() => {
          if (controller.signal.aborted) return;
          setSaveError(null);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (isApiError(error) && error.status === 401) return;
          // Best-effort: отдельного UI под отказ именно resync'а нет — следующий обрыв/reconnect
          // повторит попытку сам. Холст остаётся на последнем известном состоянии.
        });
    };

    socket.io.on('reconnect', handleReconnect);
    return () => {
      controller.abort();
      socket.io.off('reconnect', handleReconnect);
    };
  }, [boardId]);

  return { hydration, saveError, retryHydration };
}

/**
 * Общий resync-вход (SLT-40 Р2/Р3): GET содержимого доски → безусловная замена document-store.
 * Один путь для СТАРТОВОЙ гидрации и для refetch-а после reconnect — оба хотят одно и то же
 * («клиент отстал → подтянуть актуальное серверное»), поэтому решаются одним вызовом.
 *
 * `hydrate()` НЕ уведомляет autosave-слушателя (см. document.store) — ни начальная гидрация, ни
 * reconnect-refetch не должны отправить только что полученные от сервера элементы обратно на
 * сервер как «новую» правку.
 *
 * Не ловит ошибки сама — вызывающий решает, что с ними делать (стартовая гидрация показывает
 * полноэкранную ошибку, reconnect-refetch — best-effort, молча пробует снова на следующий обрыв).
 */
async function refetchDocument(boardId: string, signal?: AbortSignal): Promise<void> {
  const elements = await getBoardElements(boardId, signal);
  if (signal?.aborted) return;
  useDocumentStore.getState().hydrate(elements);
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
 * Reject одной мутации → баннер какой природы (SLT-40 Р1/Р5, дополнено SLT-43). `version_conflict`
 * — сервер уже опередил, это НЕ сетевой сбой, действие пользователя иное (перечитать актуальное,
 * а не повторить попытку). `forbidden` — своя мутация отклонена по роли (понижен/отозван, SLT-41)
 * — тоже не «повтори», а «доступ изменён». Остальные (`access_denied`/`not_found`/`conflict`/
 * `invalid_payload`) — баги/граничные случаи, не штатный конфликт редактирования; размножать UI
 * под каждый смысла нет, они делят баннер с сетевым сбоем (Р5, «минимально»).
 */
function classifyRejectReason(reason: ElementMutationRejectReason): SaveErrorKind {
  if (reason === 'version_conflict') return 'conflict';
  if (reason === 'forbidden') return 'forbidden';
  return 'network';
}

/**
 * Приоритет причины в сводном баннере пачки (batch delete, SLT-40/43): `forbidden` объясняет, ПОЧЕМУ
 * остальные штуки в пачке тоже могли не пройти — старше `conflict`, который старше `network`
 * («просто повтори»).
 */
function errorKindPriority(kind: SaveErrorKind): number {
  switch (kind) {
    case 'forbidden':
      return 2;
    case 'conflict':
      return 1;
    case 'network':
      return 0;
  }
}

/**
 * Отправляет одно семантическое изменение документа по WS и ведёт причину ошибки сохранения
 * (замена HTTP-транспорта из SLT-27 на WS, SLT-39 Р1; разрешение конфликтов — SLT-40).
 *
 * `socket` — явный параметр, а не читается из стора внутри: тестируемость и явность контракта,
 * тот же приём, что и у прежнего save().
 *
 * Успех (ok:true) — тихо синхронизирует version элемента из ack через syncElementVersion. Это
 * ПОДТВЕРЖДЕНИЕ уже отправленного, а не новое изменение: не идёт через emitChange, иначе
 * подтверждение своей же правки само стало бы поводом для следующего autosave-запроса.
 *
 * Отказ `version_conflict` (update/delete) — LAST-WRITE-WINS (SLT-40 Р1): сервер уже опередил,
 * ack несёт актуальный элемент — применяется в стор ЧЕРЕЗ REMOTE-ПУТЬ (applyRemoteUpdate), тем
 * же, каким приходят чужие broadcast-мутации, — НЕ уведомляет autosave-слушателя, иначе
 * применение чужого/актуального состояния само стало бы поводом для новой отправки (та же
 * гарантия от петли, что у remote-actions и hydrate). Своя отклонённая правка отбрасывается —
 * никакой reapply-догонки (переналожить своё поверх свежего) не происходит: это создало бы
 * пинг-понг переотправок при активном конфликте (см. докстринг тикета, вариант B — в реестр).
 * Для delete: элемент, который клиент уже удалил оптимистично из стора, applyRemoteUpdate вернёт
 * обратно (та же функция одинаково работает и когда id уже отсутствует в elements) — сервер
 * говорит «эта фигура всё ещё жива с другой version», клиент обязан её увидеть.
 *
 * Прочие отказы (access_denied/not_found/conflict/invalid_payload) — тот же персистентный
 * баннер, что при сбое autosave в SLT-27/39, стор не трогаем.
 */
export async function sendMutation(
  socket: AppSocket | null,
  change: DocumentChange,
  boardId: string,
  setSaveError: (kind: SaveErrorKind | null) => void,
): Promise<void> {
  if (!socket) {
    // Сокета нет (не подключен/разлогинен) — сохранить нечем, тот же сигнал, что явный reject.
    setSaveError('network');
    return;
  }

  const { syncElementVersion, applyRemoteUpdate } = useDocumentStore.getState();
  let errorKind: SaveErrorKind | null = null;

  switch (change.type) {
    case 'create': {
      const payload = buildCreatePayload(change.element, boardId);
      const result = await emitElementCreate(socket, payload);
      if (result.ok) {
        syncElementVersion(change.element.id, result.element.version);
      } else {
        // create не знает version_conflict (см. ElementCreateAckResult) — id-коллизия/прочее.
        errorKind = classifyRejectReason(result.reason);
      }
      break;
    }
    case 'update': {
      // version читаем из стора СЕЙЧАС (не из change): патч её не трогает, но обновиться она
      // могла с момента экшена — либо своим предыдущим ack (syncElementVersion), либо чужим
      // remote-update. Она же — та единственная точка, где хранится актуальное значение.
      const version = useDocumentStore.getState().elements[change.id]?.version ?? 0;
      const result = await emitElementUpdate(socket, {
        boardId,
        id: change.id,
        version,
        changes: change.patch,
      });
      if (result.ok) {
        syncElementVersion(change.id, result.element.version);
      } else {
        errorKind = classifyRejectReason(result.reason);
        if (result.reason === 'version_conflict') applyRemoteUpdate(result.element);
      }
      break;
    }
    case 'delete': {
      // Одиночные операции (batch — SLT-22): удаление N элементов = N параллельных
      // element_delete. version на КАЖДЫЙ уже снята в самом change (deleteElements успел убрать
      // элемент из стора раньше, чем сюда добралась асинхронная отправка).
      const results = await Promise.all(
        change.deletions.map(({ id, version }) =>
          emitElementDelete(socket, { boardId, id, version }),
        ),
      );

      for (const result of results) {
        if (result.ok) continue;
        const kind = classifyRejectReason(result.reason);
        // Приоритет в сводном баннере пачки (errorKindPriority): forbidden > conflict > network —
        // каждый несёт более конкретное действие, чем предыдущий («просто повтори»).
        if (errorKind === null || errorKindPriority(kind) > errorKindPriority(errorKind)) {
          errorKind = kind;
        }
        if (result.reason === 'version_conflict') applyRemoteUpdate(result.element);
      }
      break;
    }
  }

  setSaveError(errorKind);
}

/** Клиентский элемент → тело `element_create` (форма создания + id, см. realtime.contracts.ts). */
function buildCreatePayload(element: CanvasElement, boardId: string): ElementCreatePayload {
  return { ...toUpsertInput(element, boardId), id: element.id };
}
