import type Konva from 'konva';
import type { Box } from 'konva/lib/shapes/Transformer';
import type { RefObject } from 'react';
import { useCallback } from 'react';

import { applyResizeTransform, useDocumentStore } from '@/entities/canvas-element';
import { degToRad, normalizeAngle } from '@/shared/lib/angle';

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
 * onTransformEnd (SLT-62). Выделение сейчас single (см. useSelection.selectAt) — берём первый
 * (единственный) id; multi-resize приедет естественно с SLT-64 (Transformer уже висит на массиве
 * узлов), здесь на это не рассчитываем.
 */
export function useTransform(
  transformerRef: RefObject<Konva.Transformer | null>,
  selectedElementIds: string[],
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
    // Единственный присоединённый узел (single-select) — тот же порядок, что и
    // selectedElementIds → nodeMap в CanvasStage (transformer.nodes()[0] соответствует
    // selectedElementIds[0]).
    const node = transformerRef.current?.nodes()[0];
    const id = selectedElementIds[0];
    if (!node || !id) return;

    const { elements, updateElement } = useDocumentStore.getState();
    const element = elements[id];
    if (!element) return;

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
  }, [selectedElementIds, transformerRef]);

  return {
    enabledAnchors: isText ? CORNER_ANCHORS : ALL_ANCHORS,
    keepRatio: isText,
    boundBoxFunc,
    handleTransformEnd,
  };
}
