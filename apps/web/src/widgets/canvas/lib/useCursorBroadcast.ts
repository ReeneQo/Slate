import { type MouseEvent, useCallback, useEffect, useRef } from 'react';

import { useRealtimeStore } from '@/features/realtime-presence';
import { screenToCanvas } from '@/shared/lib/viewport';

import { useEditorStore } from '../model/editor.store';

export interface CursorBroadcastHandlers {
  onPointerMove: (event: MouseEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
}

/**
 * Отправка СВОЕГО курсора остальным участникам доски (SLT-37). Отдельный хук от
 * useCanvasInteraction: тот отвечает за pan/zoom/рисование, этот — за чисто побочный эффект
 * ретрансляции позиции, они не должны знать друг о друге.
 *
 * Троттлинг — через requestAnimationFrame, а не lodash.throttle/setInterval: rAF естественно
 * синхронизирован с кадрами браузера (~60/сек, что уже само по себе укладывается в согласованный
 * с сервером потолок ~20-30/сек, см. CursorService), и не тикает вовсе, пока вкладка не активна —
 * не нужно отдельно ставить на паузу при скрытой вкладке.
 *
 * Координаты — МИРОВЫЕ (screenToCanvas с текущим viewport), не экранные: получатели рисуют
 * курсор под СВОИМ pan/zoom, единственная система координат, одинаковая у всех — мировая (та же,
 * в которой хранятся элементы документа).
 */
export function useCursorBroadcast(): CursorBroadcastHandlers {
  const rafId = useRef<number | null>(null);
  const pendingScreenPoint = useRef<{ x: number; y: number } | null>(null);

  const flush = useCallback(() => {
    rafId.current = null;
    const screenPoint = pendingScreenPoint.current;
    if (!screenPoint) return;
    pendingScreenPoint.current = null;

    const { viewport } = useEditorStore.getState();
    const worldPoint = screenToCanvas(screenPoint, viewport);
    useRealtimeStore.getState().sendCursorMove(worldPoint);
  }, []);

  const onPointerMove = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      pendingScreenPoint.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  const onPointerLeave = useCallback((): void => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    pendingScreenPoint.current = null;
    useRealtimeStore.getState().sendCursorLeave();
  }, []);

  // Незавершённый rAF не должен пережить размонтирование холста (смена доски/уход с неё).
  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return { onPointerMove, onPointerLeave };
}
