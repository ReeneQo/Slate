import type { ReactElement } from 'react';

import type { ToolType } from '@/entities/canvas-element';

interface ToolDescriptor {
  tool: ToolType;
  label: string;
  /** Подсказка/будущий хоткей. */
  hint: string;
}

const TOOLS: readonly ToolDescriptor[] = [
  { tool: 'select', label: 'Select', hint: 'V' },
  { tool: 'rect', label: 'Rectangle', hint: 'R' },
  { tool: 'ellipse', label: 'Ellipse', hint: 'O' },
  { tool: 'line', label: 'Line', hint: 'L' },
  { tool: 'freedraw', label: 'Pencil', hint: 'P' },
  { tool: 'arrow', label: 'Arrow', hint: 'A' },
  { tool: 'text', label: 'Text', hint: 'T' },
];

interface ToolbarProps {
  selectedTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
}

/**
 * Тулбар выбора инструмента. Презентационный: состояние и обработчик приходят
 * пропсами из виджета-холста — сам компонент не знает про сторы.
 */
export function Toolbar({ selectedTool, onSelectTool }: ToolbarProps): ReactElement {
  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="fixed left-1/2 top-4 z-10 flex -translate-x-1/2 gap-1 rounded-xl border border-black/10 bg-white/90 p-1 shadow-lg backdrop-blur"
    >
      {TOOLS.map(({ tool, label, hint }) => {
        const isActive = selectedTool === tool;
        return (
          <button
            key={tool}
            type="button"
            aria-pressed={isActive}
            title={`${label} (${hint})`}
            onClick={() => onSelectTool(tool)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive ? 'bg-[#c2613d] text-white' : 'text-[#272d36] hover:bg-black/5'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
