import type { ReactElement } from 'react';

import { PresenceBar, useRealtimePresence } from '@/features/realtime-presence';

import { useCanvasSync } from '../lib/useCanvasSync';
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
 */
export function BoardCanvas({ boardId }: BoardCanvasProps): ReactElement {
  const { hydration, saveError, retryHydration } = useCanvasSync(boardId);
  useRealtimePresence(boardId);

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
      <PresenceBar />
      <CanvasStage />
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
