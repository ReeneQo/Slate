import { useEffect } from 'react';

import { useDocumentStore, useHistoryStore } from '@/entities/canvas-element';
import { isEditableTarget } from '@/shared/lib/dom';

import { useEditorStore } from '../model/editor.store';

/**
 * Одно правило клавиатурного хоткея холста: `match` решает, откликается ли событие, `run`
 * выполняет действие (сам решает, нужен ли `preventDefault` — см. Delete/Backspace ниже, где
 * это зависит от того, было ли что удалять).
 */
interface HotkeyRule {
  match: (event: KeyboardEvent) => boolean;
  run: (event: KeyboardEvent) => void;
}

/** Delete/Backspace БЕЗ модификаторов — с модификатором (напр. Ctrl+Backspace) правило не матчится. */
export function matchesDelete(event: KeyboardEvent): boolean {
  return (event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey;
}

/**
 * Undo — кроссплатформенно: Cmd (Mac) или Ctrl (Win/Linux) + Z, БЕЗ Shift.
 * Матчим по `event.code` (физическая клавиша), НЕ `event.key` (SLT-67) — так комбо работает
 * независимо от раскладки (кириллица и т.д.), не только на латинице.
 */
export function matchesUndo(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.code === 'KeyZ' && !event.shiftKey;
}

/** Redo — Cmd/Ctrl+Shift+Z (кроссплатформенно) ИЛИ Ctrl+Y (Windows-конвенция). См. matchesUndo про `code`. */
export function matchesRedo(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    ((event.shiftKey && event.code === 'KeyZ') || event.code === 'KeyY')
  );
}

const rules: HotkeyRule[] = [
  {
    match: matchesDelete,
    run: (event) => {
      const { selectedElementIds, setSelectedElementIds, canEdit } = useEditorStore.getState();
      if (selectedElementIds.length === 0) return; // нечего удалять — не гасим клавишу
      // Роль-гейт (SLT-43): viewer выделяет (для просмотра), но не удаляет — выделение
      // остаётся активным (см. editor.store), удаление гасится здесь же, отдельным условием.
      if (!canEdit) return;

      // preventDefault: без фокуса на поле Backspace листает историю браузера («назад»).
      event.preventDefault();

      // Документ и выделение — в разных сторах (entities vs widget), одним атомарным set их не
      // свести. deleteElements чистит elements+elementIds атомарно (и пишет инверсию в историю,
      // SLT-65); выделение (сессионное UI-состояние) гасим здесь явно.
      useDocumentStore.getState().deleteElements(selectedElementIds);
      setSelectedElementIds([]);
    },
  },
  {
    match: matchesUndo,
    run: (event) => {
      event.preventDefault();
      useHistoryStore.getState().undo();
    },
  },
  {
    match: matchesRedo,
    run: (event) => {
      event.preventDefault();
      useHistoryStore.getState().redo();
    },
  },
];

/**
 * Активен оверлей или незавершённый жест холста (SLT-65, П8) — undo/redo/delete не должны
 * перехватывать клавишу: в text-оверлее (`editingTextId`/`draft`) должен работать НАТИВНЫЙ undo
 * текста, посреди marquee/drag клавиатурная мутация документа была бы преждевременной.
 */
function isCanvasGestureActive(): boolean {
  const { editingTextId, draft, marqueeRect, isDraggingElement } = useEditorStore.getState();
  return editingTextId !== null || draft !== null || marqueeRect !== null || isDraggingElement;
}

/**
 * Единая точка клавиатурного ввода холста. Один window-listener, внутри — массив правил
 * `{match, run}` (SLT-65, рефактор switch→rules: первый хоткей с модификатором — undo/redo —
 * потребовал комбинаций, которые неудобно было бы наращивать в плоском switch по event.key).
 * Симметричен useDrawing/useSelection/useCanvasInteraction: ещё один контроллер ввода уровня
 * виджета, только клавиатурный.
 *
 * Стор читаем через getState() в момент события (не через подписку): listener ставится один
 * раз, а свежее состояние нужно только когда клавиша уже нажата.
 */
export function useCanvasHotkeys(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Guard заложен сразу: не мешаем вводу текста и незавершённым жестам холста.
      if (isEditableTarget(event.target)) return;
      if (isCanvasGestureActive()) return;

      for (const rule of rules) {
        if (rule.match(event)) {
          rule.run(event);
          return; // первое сматчившееся правило — правила взаимоисключающие по конструкции
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown); // cleanup обязателен
  }, []);
}
