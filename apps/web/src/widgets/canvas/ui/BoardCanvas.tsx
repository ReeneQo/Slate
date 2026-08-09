import { type ReactElement, useEffect, useState } from 'react';

import { useBoardRole } from '@/features/board-list';
import { ShareDialog } from '@/features/board-sharing';
import { PresenceBar, useRealtimePresence } from '@/features/realtime-presence';

import { deriveCanEdit } from '../lib/canEdit';
import { useCanvasSync } from '../lib/useCanvasSync';
import { useEditorStore } from '../model/editor.store';
import { CanvasStage } from './CanvasStage';
import { SyncErrorBanner } from './SyncErrorBanner';

interface BoardCanvasProps {
  /** id доски из роута (`/boards/:id`). Единственный источник boardId — маршрут, не стор (Р8). */
  boardId: string;
}

/**
 * Виджет холста доски: соединяет Konva-шелл (CanvasStage) с бэком через useCanvasSync (SLT-27) и
 * с realtime-presence (SLT-37) через useRealtimePresence — независимые потоки, документ и
 * presence/курсоры не знают друг о друге. До готовности холст не монтируем — это заодно закрывает
 * гонку «нарисовал раньше, чем догрузилось»: пока грузим, Stage нет, значит и пользовательских
 * изменений нет.
 *
 * Роль-гейт (SLT-43): `useBoardRole` — селектор над кэшем `GET /boards` (features/board-list,
 * НЕ отдельный запрос, см. её докстринг), `deriveCanEdit` превращает роль в единый флаг мутации.
 * Кладём его в editor-стор эффектом (не читаем каждый обработчик через отдельный хук) — та же
 * точка, из которой useDrawing/useCanvasHotkeys/useCanvasInteraction уже читают viewport/
 * selectedTool через getState().
 *
 * Кнопка «Участники» — точка входа в `ShareDialog` для owner (управление, полный доступ) И
 * editor (только список — SLT-43, решение 3). В отличие от `BoardCard` в списке досок (там
 * «Поделиться» видит только owner, решение 4), здесь editor тоже должен видеть, кто ещё на доске,
 * пока на ней работает — списочная карточка для этого не место (editor её не открывает в режиме
 * управления), а холст — то самое место, где editor реально сейчас находится.
 */
export function BoardCanvas({ boardId }: BoardCanvasProps): ReactElement {
  const { hydration, saveError, retryHydration } = useCanvasSync(boardId);
  useRealtimePresence(boardId);

  const role = useBoardRole(boardId);
  const canEdit = deriveCanEdit(role);
  const setCanEdit = useEditorStore((state) => state.setCanEdit);
  useEffect(() => setCanEdit(canEdit), [canEdit, setCanEdit]);

  const [membersOpen, setMembersOpen] = useState(false);
  const canViewMembers = role === 'owner' || role === 'editor';

  if (hydration === 'loading') {
    return <CanvasMessage>Загрузка доски…</CanvasMessage>;
  }

  if (hydration === 'error') {
    return (
      <CanvasMessage>
        Не удалось загрузить доску.
        <button
          type="button"
          onClick={retryHydration}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-text-on-accent transition-colors hover:bg-accent-hover"
        >
          Повторить
        </button>
      </CanvasMessage>
    );
  }

  return (
    <>
      {saveError && <SyncErrorBanner kind={saveError} />}
      {canViewMembers && (
        <button
          type="button"
          onClick={() => setMembersOpen(true)}
          className="fixed left-4 top-4 z-10 rounded-xl border border-black/10 bg-white/90 px-3 py-1.5 text-sm font-medium text-[#272d36] shadow-lg backdrop-blur transition-colors hover:bg-black/5"
        >
          Участники
        </button>
      )}
      <PresenceBar />
      <CanvasStage />
      {role && (
        <ShareDialog
          boardId={boardId}
          accessRole={role}
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </>
  );
}

/** Полноэкранное статус-сообщение холста (загрузка/ошибка гидрации). */
function CanvasMessage({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-canvas text-sm text-text-muted">
      {children}
    </main>
  );
}
