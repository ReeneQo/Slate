import { useEffect } from 'react';

import { useDocumentStore } from '@/entities/canvas-element';
import { isEditableTarget } from '@/shared/lib/dom';

import { useEditorStore } from '../model/editor.store';

/**
 * Единая точка клавиатурного ввода холста. Один window-listener, внутри — роутинг
 * клавиш по действиям. Симметричен useDrawing/useSelection/useCanvasInteraction:
 * ещё один контроллер ввода уровня виджета, только клавиатурный.
 *
 * Сейчас наполнен одним действием — Delete/Backspace удаляет выделение. Задел под
 * рост: инструменты (V/R/O/L), undo (Ctrl+Z), копипаст добавляются новой веткой
 * в switch — listener, cleanup и guard на поля ввода уже общие.
 *
 * NOTE: switch по event.key намеренно оставлен простым (YAGNI — комбо с
 * модификаторами ещё нет). При добавлении первого хоткея с модификатором
 * (undo/копипаст) — пересмотреть на массив правил { match(e), run() }.
 *
 * Стор читаем через getState() в момент события (не через подписку): listener
 * ставится один раз, а свежее выделение нужно только когда клавиша уже нажата.
 */
export function useCanvasHotkeys(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Guard заложен сразу: не мешаем вводу текста ещё до появления текстовых фигур.
      if (isEditableTarget(event.target)) return;

      switch (event.key) {
        case 'Delete':
        case 'Backspace': {
          const { selectedElementIds, setSelectedElementIds, canEdit } = useEditorStore.getState();
          if (selectedElementIds.length === 0) return; // нечего удалять — не гасим клавишу
          // Роль-гейт (SLT-43): viewer выделяет (для просмотра), но не удаляет — выделение
          // остаётся активным (см. editor.store), удаление гасится здесь же, отдельным условием.
          if (!canEdit) return;

          // preventDefault: без фокуса на поле Backspace листает историю браузера («назад»).
          event.preventDefault();

          // Документ и выделение — в разных сторах (entities vs widget), одним
          // атомарным set их не свести. deleteElements чистит elements+elementIds
          // атомарно; выделение (сессионное UI-состояние) гасим здесь явно.
          // NOTE: путь удаления пока один. Когда их станет >1 (контекстное меню,
          // программное удаление, undo) — вынести сброс выделения в прунинг-подписку
          // editor↔document, чтобы очистка была в одной точке.
          useDocumentStore.getState().deleteElements(selectedElementIds);
          setSelectedElementIds([]);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown); // cleanup обязателен
  }, []);
}
