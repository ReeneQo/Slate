import type Konva from 'konva';
import { type ReactElement, type RefObject, useCallback } from 'react';

import { getDocumentBounds, useDocumentStore } from '@/entities/canvas-element';
import type { Viewport } from '@/shared/lib/viewport';

import { downloadDataUrl } from '../lib/downloadDataUrl';
import { exportBoardPng } from '../lib/exportBoardPng';
import { buildExportFilename } from '../lib/filename';

interface ExportButtonProps {
  /** Из роута (widgets/canvas/ui/BoardCanvas) — фоллбэк имени файла, если название доски пусто. */
  boardId: string;
  /** `useBoardTitle` (features/board-list), проброшено сверху — features→features запрещён боундарями. */
  boardTitle: string | undefined;
  /** Текущий pan/zoom (editor-store, widgets/canvas) — фича не имеет права импортировать
   * widgets-стор напрямую, поэтому значение приходит пропом. */
  viewport: Viewport;
  /** Основной Konva Layer (CanvasStage) — снимаем PNG именно с него, не со Stage, чтобы курсоры
   * (отдельный Layer) физически не попали в кадр. */
  layerRef: RefObject<Konva.Layer | null>;
  /** Transformer основного слоя — на время снятия прячем рамку выделения. */
  transformerRef: RefObject<Konva.Transformer | null>;
}

/**
 * Кнопка «Экспорт PNG» всей доски (SLT-66). Доступна ВСЕМ ролям (в отличие от Toolbar, который
 * только canEdit) — экспорт не мутирует документ, viewer тоже вправе скачать снимок доски.
 *
 * Disabled на пустой доске: `getDocumentBounds` пустого набора элементов вернул бы null, снимать
 * нечего — та же проверка держит и disabled-состояние (реактивно, по elementIds.length), и ранний
 * выход в обработчике клика (на случай гонки между рендером кнопки и кликом).
 */
export function ExportButton({
  boardId,
  boardTitle,
  viewport,
  layerRef,
  transformerRef,
}: ExportButtonProps): ReactElement {
  const isEmpty = useDocumentStore((state) => state.elementIds.length === 0);

  const handleExport = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const elements = Object.values(useDocumentStore.getState().elements);
    const bounds = getDocumentBounds(elements);
    if (!bounds) return;

    const dataUrl = exportBoardPng({
      layer,
      bounds,
      viewport,
      transformer: transformerRef.current,
    });
    downloadDataUrl(dataUrl, buildExportFilename(boardTitle, boardId, new Date()));
  }, [layerRef, transformerRef, viewport, boardTitle, boardId]);

  return (
    <button
      type="button"
      disabled={isEmpty}
      onClick={handleExport}
      title="Export board as PNG"
      className="fixed bottom-4 right-4 z-10 rounded-xl border border-black/10 bg-white/90 px-3 py-1.5 text-sm font-medium text-[#272d36] shadow-lg backdrop-blur transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/90"
    >
      Export PNG
    </button>
  );
}
