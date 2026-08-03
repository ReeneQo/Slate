import type { ReactElement } from 'react';

/**
 * Персистентный баннер проблемы сохранения (SLT-27 Р9). Именно баннер, а не единичный toast:
 * проблема ДЛЯЩАЯСЯ (пока autosave не долетает), и статус должен быть виден всё это время, а не
 * мелькнуть один раз. Скрывается (виджет перестаёт его рендерить), когда очередное сохранение
 * снова проходит.
 *
 * Текст — ТОЛЬКО про сохранение. Ничего про «не обновляется»: поток односторонний (store →
 * сервер), обновлений с сервера в этой задаче нет (realtime — этап 3), и обещать их баннером
 * нельзя.
 *
 * Не перехватывает клики (`pointer-events-none`) — холст под баннером остаётся рабочим: данные не
 * потеряны, юзер продолжает рисовать, autosave повторит попытку на следующем изменении.
 */
export function SyncErrorBanner(): ReactElement {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div
        role="alert"
        className="pointer-events-auto flex items-center gap-2 rounded-lg border border-danger-border bg-danger-subtle px-4 py-2 text-sm font-medium text-danger-text shadow-sm"
      >
        <span aria-hidden className="text-base leading-none">
          ⚠
        </span>
        Не удалось сохранить изменения — проблема с сетью
      </div>
    </div>
  );
}
