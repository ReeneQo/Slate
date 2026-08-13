import { useCallback } from 'react';

import { hitTestElement, useDocumentStore } from '@/entities/canvas-element';
import { type Point, screenToCanvas } from '@/shared/lib/viewport';

import { useEditorStore } from '../model/editor.store';

/**
 * Слабина попадания в экранных пикселях. Делим на scale, чтобы «зона клика»
 * вокруг фигуры на холсте оставалась постоянной по ощущению при любом зуме.
 * Побольше — чтобы по тонким фигурам (линии) было проще попасть.
 *
 * Экспортируется как единый источник: тот же паддинг задаёт hitStrokeWidth узлов
 * (ElementShape), чтобы зона ЗАХВАТА нативного drag совпадала с зоной КУРСОРА.
 */
export const HIT_PADDING_PX = 8;

export interface SelectionController {
  /**
   * Клик в select-режиме: выделяет верхнюю фигуру под курсором или снимает выделение.
   * Возвращает id выделенной фигуры (или null) — вызывающий стартует по нему drag/marquee.
   *
   * shiftKey (SLT-64): true → toggle найденного id в текущем выделении (добавить/убрать), не
   * заменяя остальное; клик по пустому месту с shift — no-op (выделение не трогаем, вызывающий
   * решает, что делать дальше — см. useCanvasInteraction, marquee игнорирует shift по тому же
   * принципу). false (обычный клик) — прежнее поведение: заменяет выделение на [id] или [].
   */
  selectAt: (screen: Point, shiftKey?: boolean) => string | null;
  /** Верхняя фигура под указателем или null. Чистый запрос без записи в стор (для hover). */
  findAt: (screen: Point) => string | null;
}

/**
 * Контроллер выделения. По аналогии с useDrawing — инкапсулирует один жест
 * (клик) и пишет результат в editor-стор (selectedElementIds).
 *
 * Состояние документа и вьюпорт читаем через getState() прямо в обработчике:
 * это click-путь, а не render, поэтому подписка (и лишние ре-рендеры) не нужны —
 * важно лишь получить свежие данные в момент клика. Реактивность позиции при
 * рендере обеспечивает ShapeRenderer своим селектором, здесь она ни к чему.
 */
export function useSelection(): SelectionController {
  const setSelectedElementIds = useEditorStore((state) => state.setSelectedElementIds);

  const findAt = useCallback((screen: Point): string | null => {
    const { viewport } = useEditorStore.getState();
    const { elements, elementIds } = useDocumentStore.getState();

    const point = screenToCanvas(screen, viewport);
    const tolerance = HIT_PADDING_PX / viewport.scale;

    // Идём с конца elementIds — это z-order, верхняя фигура выигрывает.
    for (let i = elementIds.length - 1; i >= 0; i -= 1) {
      const id = elementIds[i];
      if (!id) continue;

      const element = elements[id];
      if (element && hitTestElement(element, point, tolerance)) return id;
    }

    return null;
  }, []);

  const selectAt = useCallback(
    (screen: Point, shiftKey = false): string | null => {
      const id = findAt(screen);

      if (id === null) {
        // Клик по пустому месту без shift — снимаем выделение (прежнее поведение). С shift —
        // намеренный no-op: пустой клик с зажатым shift ничего не значит для выделения, а
        // вызывающий (useCanvasInteraction) на этом же id === null решает, стартовать ли marquee.
        if (!shiftKey) setSelectedElementIds([]);
        return null;
      }

      if (shiftKey) {
        // Toggle: не трогаем остальное выделение, только этот id.
        const { selectedElementIds } = useEditorStore.getState();
        const next = selectedElementIds.includes(id)
          ? selectedElementIds.filter((existingId) => existingId !== id)
          : [...selectedElementIds, id];
        setSelectedElementIds(next);
        return id;
      }

      setSelectedElementIds([id]);
      return id;
    },
    [findAt, setSelectedElementIds],
  );

  return { selectAt, findAt };
}
