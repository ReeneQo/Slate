import type { KonvaEventObject, Node } from 'konva/lib/Node';
import { type RefObject, useCallback, useRef } from 'react';

import { useDocumentStore } from '@/entities/canvas-element';

import { useEditorStore } from '../model/editor.store';
import { computeGroupDragPositions, type GroupDragSibling } from './groupDrag';

interface ActiveGroupDrag {
  /** Стартовая позиция ВЕДУЩЕГО узла в его СОБСТВЕННЫХ Konva-координатах (для дельты). */
  leaderStartNodeX: number;
  leaderStartNodeY: number;
  /** Модельные (для коммита) И node-space (для live-визуала) старт-позиции остальных выделенных. */
  siblingsModel: GroupDragSibling[];
  siblingsNode: GroupDragSibling[];
}

export interface GroupDragController {
  onDragStart: (e: KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
}

function findNodeId(nodeMap: Map<string, Node>, node: Node): string | null {
  for (const [id, candidate] of nodeMap) {
    if (candidate === node) return id;
  }
  return null;
}

/**
 * Синхронизирует drag ГРУППЫ выделенных фигур (SLT-64, Вариант B, зафиксирован на точке сверки).
 * Ведущий узел (тот, за который держит курсор) тащится нативным Konva draggable как обычно —
 * его собственный onDragEnd (ElementShape → ShapeRenderer.updateElement) коммитит его позицию САМ,
 * этот хук в него не вмешивается. Остальные выделенные узлы сдвигаются императивно на ту же
 * дельту: на dragmove — только визуально (node.x()/y(), мимо стора, для живой синхронной картинки),
 * на dragend — коммитятся в document-стор N отдельными updateElement (без batch, SLT-68 отдельно).
 *
 * Активируется, ТОЛЬКО если тащат узел, входящий в multi-выделение (>1 элемент) — иначе это
 * обычный одиночный drag, который уже полностью самодостаточен (см. точку сверки, факт I), и
 * activeDrag остаётся null, о чём и заботится ранний return в onDragStart.
 *
 * Konva.Transformer резайзит/крутит через СВОИ анкеры — отдельные draggable-узлы, которых нет в
 * nodeMap (тот наполняется только зарегистрированными фигурами, см. CanvasStage.registerNode).
 * findNodeId на анкере вернёт null → activeDrag не заведётся → resize/rotate не пересекаются с
 * этой логикой, несмотря на то что drag-события анкеров тоже всплывают до Stage.
 */
export function useGroupDrag(nodeMap: RefObject<Map<string, Node>>): GroupDragController {
  const activeDrag = useRef<ActiveGroupDrag | null>(null);

  const onDragStart = useCallback(
    (e: KonvaEventObject<DragEvent>): void => {
      const leaderId = findNodeId(nodeMap.current, e.target);
      if (!leaderId) return;

      const { selectedElementIds } = useEditorStore.getState();
      if (selectedElementIds.length <= 1 || !selectedElementIds.includes(leaderId)) return;

      const { elements } = useDocumentStore.getState();
      const siblingIds = selectedElementIds.filter((id) => id !== leaderId);

      const siblingsModel: GroupDragSibling[] = [];
      const siblingsNode: GroupDragSibling[] = [];
      for (const id of siblingIds) {
        const element = elements[id];
        const node = nodeMap.current.get(id);
        if (!element || !node) continue; // фигура/узел исчезли между рендером и жестом — пропускаем
        siblingsModel.push({ id, startX: element.x, startY: element.y });
        siblingsNode.push({ id, startX: node.x(), startY: node.y() });
      }

      activeDrag.current = {
        leaderStartNodeX: e.target.x(),
        leaderStartNodeY: e.target.y(),
        siblingsModel,
        siblingsNode,
      };
    },
    [nodeMap],
  );

  const onDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>): void => {
      const active = activeDrag.current;
      if (!active) return;

      const dx = e.target.x() - active.leaderStartNodeX;
      const dy = e.target.y() - active.leaderStartNodeY;

      for (const position of computeGroupDragPositions(active.siblingsNode, dx, dy)) {
        const node = nodeMap.current.get(position.id);
        if (!node) continue;
        node.x(position.x);
        node.y(position.y);
      }
      e.target.getLayer()?.batchDraw();
    },
    [nodeMap],
  );

  const onDragEnd = useCallback((e: KonvaEventObject<DragEvent>): void => {
    const active = activeDrag.current;
    activeDrag.current = null;
    if (!active) return;

    const dx = e.target.x() - active.leaderStartNodeX;
    const dy = e.target.y() - active.leaderStartNodeY;
    const { updateElement } = useDocumentStore.getState();

    for (const position of computeGroupDragPositions(active.siblingsModel, dx, dy)) {
      updateElement(position.id, { x: position.x, y: position.y });
    }
  }, []);

  return { onDragStart, onDragMove, onDragEnd };
}
