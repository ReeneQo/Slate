import type { Node } from 'konva/lib/Node';

/**
 * Обратный поиск id по Konva-узлу (реестр nodeMap в CanvasStage — id → Node, здесь наоборот).
 * Общий для useGroupDrag и useTransform (SLT-64): оба должны знать, КАКОМУ элементу принадлежит
 * узел, пришедший в bubbled Konva-событии (drag) или из transformer.nodes() — и в обоих случаях
 * НЕ через позиционное совпадение с selectedElementIds (оно ломается, если у какого-то id ещё/уже
 * нет узла в nodeMap — массивы расходятся по длине, и индексы съезжают), а через identity узла,
 * которая не зависит от порядка/полноты массивов.
 */
export function findNodeId(nodeMap: Map<string, Node>, node: Node): string | null {
  for (const [id, candidate] of nodeMap) {
    if (candidate === node) return id;
  }
  return null;
}
