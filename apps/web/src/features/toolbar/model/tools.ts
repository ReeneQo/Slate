import type { ToolType } from '@/entities/canvas-element';

interface ToolDescriptor {
  tool: ToolType;
  label: string;
  /** Физическая клавиша (`KeyboardEvent.code`) — единый источник для хоткея И подсказки в UI. */
  code: string;
}

/**
 * Единая раскладка инструментов: tool ↔ код физической клавиши. Источник и для подписи-подсказки
 * в тулбаре (см. `hintFromCode` ниже), и для хоткеев (SLT-67, `useCanvasHotkeys`) — чтобы буква
 * в UI и клавиша матчера не могли разъехаться.
 */
export const TOOLS: readonly ToolDescriptor[] = [
  { tool: 'select', label: 'Select', code: 'KeyV' },
  { tool: 'rect', label: 'Rectangle', code: 'KeyR' },
  { tool: 'ellipse', label: 'Ellipse', code: 'KeyO' },
  { tool: 'line', label: 'Line', code: 'KeyL' },
  { tool: 'freedraw', label: 'Pencil', code: 'KeyP' },
  { tool: 'arrow', label: 'Arrow', code: 'KeyA' },
  { tool: 'text', label: 'Text', code: 'KeyT' },
];

/** 'KeyR' → 'R' — подпись-подсказка, выведенная из кода клавиши (не хранится отдельно). */
export function hintFromCode(code: string): string {
  return code.replace('Key', '');
}
