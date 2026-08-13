import type Konva from 'konva';
import type { Node } from 'konva/lib/Node';
import type { Box } from 'konva/lib/shapes/Transformer';
import type { RefObject } from 'react';
import { useCallback } from 'react';

import {
  applyResizeTransform,
  beginTransaction,
  endTransaction,
  useDocumentStore,
} from '@/entities/canvas-element';
import { degToRad, normalizeAngle } from '@/shared/lib/angle';

import { findNodeId } from './nodeRegistry';

/**
 * Минимальный габарит рамки при ресайзе — UI-эргономика Transformer'а, НЕ серверная валидация
 * геометрии: SHAPE_SIZE_MIN в shared-types равен 0 (граница ВАЛИДНОСТИ данных, а не то, ниже
 * чего неудобно/нельзя тянуть рамку), использовать её здесь напрямую значило бы разрешить
 * схлопнуть фигуру в точку. Живёт локально — смысл имеет только для Konva Transformer.
 */
const MIN_RESIZE_SIZE = 10;

/** Полный набор ручек — свободный (неравномерный) ресайз rect/ellipse/line/arrow/freedraw. */
const ALL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** Только углы — пропорциональный ресайз text (вместе с keepRatio). */
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export interface TransformController {
  enabledAnchors: string[];
  keepRatio: boolean;
  boundBoxFunc: (oldBox: Box, newBox: Box) => Box;
  handleTransformEnd: () => void;
}

/**
 * Связывает Konva Transformer с document-стором: считает, какие ручки/keepRatio нужны
 * выделенному типу фигуры, ограничивает минимальный габарит и запекает scale в геометрию по
 * onTransformEnd (SLT-62). enabledAnchors/keepRatio смотрят на ПЕРВЫЙ выделенный id — для
 * multi-select с разнородными типами это может дать неидеальный набор ручек (напр. свободный
 * ресайз для группы, где есть text) — известное упрощение SLT-64, не входит в её объём, дальше не
 * трогаем.
 */
export function useTransform(
  transformerRef: RefObject<Konva.Transformer | null>,
  selectedElementIds: string[],
  nodeMap: RefObject<Map<string, Node>>,
): TransformController {
  const selectedType = useDocumentStore((state) => {
    const id = selectedElementIds[0];
    return id ? state.elements[id]?.type : undefined;
  });

  const isText = selectedType === 'text';

  const boundBoxFunc = useCallback((oldBox: Box, newBox: Box): Box => {
    if (newBox.width < MIN_RESIZE_SIZE || newBox.height < MIN_RESIZE_SIZE) return oldBox;
    return newBox;
  }, []);

  const handleTransformEnd = useCallback(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    // SLT-64: Transformer уже привязан к МАССИВУ узлов (CanvasStage), multi-resize/rotate
    // включаются перебором nodes(). Id для каждого узла ищем через nodeMap (findNodeId, identity
    // узла), а НЕ позиционным совпадением nodes()[i] ↔ selectedElementIds[i] — то совпадение
    // хрупкое: массив, который CanvasStage передаёт в transformer.nodes(...), строится через
    // selectedElementIds.map(id => nodeMap.get(id)).filter(Boolean) — если у какого-то id узла ещё
    // уже нет в nodeMap (гонка гидратации/удаления), массив короче selectedElementIds и все индексы
    // после пропуска съезжают. Konva сам порядок _nodes не переставляет (проверено по исходнику
    // Transformer.setNodes — фильтрует только ancestor-of-transformer, не переупорядочивает), но
    // САМА длина массива не гарантирована равной selectedElementIds — identity-поиск устраняет
    // зависимость от этого совпадения полностью.
    const { elements, updateElement } = useDocumentStore.getState();

    // Один жест Transformer'а (resize ИЛИ rotate, одиночный или multi-select) = один шаг undo
    // (SLT-65, Р2): begin/end оборачивают весь forEach безусловно, даже для одного элемента —
    // транзакция из одной операции ничем не хуже соло-записи, а код проще без ветвления по count.
    beginTransaction();
    transformer.nodes().forEach((node) => {
      const id = findNodeId(nodeMap.current, node);
      const element = id ? elements[id] : undefined;
      if (!id || !element) return;

      // onTransformEnd прилетает и на resize-, и на rotate-гест Transformer'а (это два раздельных
      // жеста — тянешь угловую ручку или ручку-вращалку — но обработчик один), поэтому запекаем ОБА
      // независимо одним патчем. x/y здесь уже per-type origin, который сам держит Konva (SLT-62 для
      // resize, SLT-63 для rotate — на повёрнутом узле Konva сдвигает x/y ТАК ЖЕ, как для чистого
      // ресайза, formula применяется без изменений, см. точку сверки SLT-63): rect/line/freedraw/
      // arrow/text — угол рамки, ellipse — центр. При чистом rotate (scale=1) applyResizeTransform —
      // геометрический no-op, x/y просто берутся из узла как есть. При чистом resize rotation() не
      // меняется — angle патча перезапишет модель тем же значением, тоже no-op.
      const resizePatch = applyResizeTransform(element, {
        x: node.x(),
        y: node.y(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      });
      const angle = normalizeAngle(degToRad(node.rotation()));

      // Обязательный сброс: Konva меняет scaleX/scaleY узла, а не его размеры/points. Не сбросить —
      // на следующем ресайзе scale накопится поверх уже запечённой геометрии, и фигура «уплывёт».
      // rotation() НЕ сбрасываем: angle теперь в модели, следующий рендер применит его тем же
      // значением через ElementShape (rotation={radToDeg(angle)}) — идемпотентно, без двойного
      // поворота.
      node.scaleX(1);
      node.scaleY(1);

      updateElement(id, { ...resizePatch, angle });
    });
    endTransaction();
  }, [transformerRef, nodeMap]);

  return {
    enabledAnchors: isText ? CORNER_ANCHORS : ALL_ANCHORS,
    keepRatio: isText,
    boundBoxFunc,
    handleTransformEnd,
  };
}
