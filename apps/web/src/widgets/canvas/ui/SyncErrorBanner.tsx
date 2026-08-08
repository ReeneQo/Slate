import type { ReactElement } from 'react';

import type { SaveErrorKind } from '../lib/useCanvasSync';

interface SyncErrorBannerProps {
  kind: SaveErrorKind;
}

/**
 * Персистентный баннер проблемы сохранения (SLT-27 Р9, текст различён по причине — SLT-40 Р5).
 * Именно баннер, а не единичный toast: проблема ДЛЯЩАЯСЯ (пока autosave не долетает/пока конфликт
 * не разрешён), и статус должен быть виден всё это время, а не мелькнуть один раз. Скрывается
 * (виджет перестаёт его рендерить), когда очередное сохранение снова проходит либо reconnect-
 * resync (SLT-40) заменяет стор актуальным состоянием.
 *
 * ДВА ТЕКСТА, НЕ ОДИН (SLT-40 Р5): `network` — сеть/сервер мертвы, действие юзера — просто ждать
 * (autosave повторит попытку на следующем изменении). `conflict` — version_conflict: сервер уже
 * принял чужую правку раньше, ваша отклонена и стор уже показывает актуальное серверное состояние
 * (last-write-wins, useCanvasSync/sendMutation) — действие юзера другое: не «подождать сеть», а
 * «посмотреть, что стало, и решить, повторять ли правку». Прочие причины отказа (access_denied/
 * not_found/invalid_payload/create-conflict) делят текст с `network` — они баги/граничные случаи,
 * не штатный конфликт редактирования, отдельный текст под них не оправдан (Р5, «минимально»).
 *
 * Не перехватывает клики (`pointer-events-none`) — холст под баннером остаётся рабочим: данные не
 * потеряны молча (при конфликте — заменены заметно, с этим самым сообщением), юзер продолжает
 * работать.
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
        {kind === 'conflict'
          ? 'Элемент изменён другим участником — ваша правка не применена'
          : 'Не удалось сохранить изменения — проблема с сетью'}
      </div>
    </div>
  );
}
