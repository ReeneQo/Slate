import { TEXT_FONT_SIZE_MAX, TEXT_FONT_SIZE_MIN } from '@slate/shared-types';

import type { ElementPatch } from './document.store';
import type { CanvasElement } from './types';

/**
 * Снятое с Konva-узла состояние после ресайза: новые x/y (Transformer сдвигает
 * origin при ресайзе от угла/стороны) и накопленный scaleX/scaleY (Konva меняет
 * масштаб узла, не его размеры/points — их нужно запечь явно).
 */
export interface ResizeTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Запекает Konva-scale в геометрию элемента — по каждому типу своя формула,
 * см. точку сверки SLT-62. Не трогает angle/strokeWidth (стиль и поворот
 * ресайзом не меняются) — патч содержит только x/y/data.
 */
export function applyResizeTransform(
  element: CanvasElement,
  transform: ResizeTransform,
): ElementPatch {
  const { x, y, scaleX, scaleY } = transform;

  if (element.type === 'rect') {
    return {
      x,
      y,
      data: { width: element.data.width * scaleX, height: element.data.height * scaleY },
    };
  }

  if (element.type === 'ellipse') {
    // Konva.Ellipse стоит в ЦЕНТРЕ (см. nodePositionToModel в ElementShape.tsx) — новые x/y
    // модели (угол рамки) считаем от НОВЫХ (уже отмасштабированных) width/height, а не старых.
    const width = element.data.width * scaleX;
    const height = element.data.height * scaleY;
    return { x: x - width / 2, y: y - height / 2, data: { width, height } };
  }

  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    // points относительны x/y элемента (element.ts, updateDraftGeometry) — масштабируем каждую
    // координату по своей оси: чётные индексы (x) на scaleX, нечётные (y) на scaleY.
    const points = element.data.points.map((value, index) =>
      index % 2 === 0 ? value * scaleX : value * scaleY,
    );
    return { x, y, data: { points } };
  }

  // text: ресайз пропорциональный (keepRatio на Transformer), scaleX === scaleY — берём scaleX.
  // fontSize — единственная геометрия текста, width/height у него нет.
  const fontSize = clamp(element.data.fontSize * scaleX, TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX);
  return {
    x,
    y,
    data: { text: element.data.text, fontSize, fontFamily: element.data.fontFamily },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
