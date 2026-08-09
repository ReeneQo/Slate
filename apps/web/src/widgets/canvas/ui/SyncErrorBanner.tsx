import type { ReactElement } from 'react';

import { syncErrorMessage } from '../lib/syncErrorMessage';
import type { SaveErrorKind } from '../lib/useCanvasSync';

interface SyncErrorBannerProps {
  kind: SaveErrorKind;
}

/**
 * Персистентный баннер проблемы сохранения (SLT-27 Р9, текст различён по причине — SLT-40 Р5,
 * SLT-43). Именно баннер, а не единичный toast: проблема ДЛЯЩАЯСЯ (пока autosave не долетает/пока
 * конфликт не разрешён/пока доступ не вернут), и статус должен быть виден всё это время, а не
 * мелькнуть один раз. Скрывается (виджет перестаёт его рендерить), когда очередное сохранение
 * снова проходит либо reconnect-resync (SLT-40) заменяет стор актуальным состоянием.
 *
 * Не перехватывает клики (`pointer-events-none`) — холст под баннером остаётся рабочим: данные не
 * потеряны молча (при конфликте — заменены заметно, с этим самым сообщением), юзер продолжает
 * работать (viewer после понижения — читает, что и так может).
 */
export function SyncErrorBanner({ kind }: SyncErrorBannerProps): ReactElement {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div
        role="alert"
        className="pointer-events-auto flex items-center gap-2 rounded-lg border border-danger-border bg-danger-subtle px-4 py-2 text-sm font-medium text-danger-text shadow-sm"
      >
        <span aria-hidden className="text-base leading-none">
          ⚠
        </span>
        {syncErrorMessage(kind)}
      </div>
    </div>
  );
}
