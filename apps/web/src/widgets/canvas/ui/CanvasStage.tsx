import type { ReactElement } from 'react';
import { Layer, Stage } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';

import { useDocumentStore } from '@/entities/canvas-element';
import { Toolbar } from '@/features/toolbar';

import { useCanvasInteraction } from '../lib/useCanvasInteraction';
import { useViewportSize } from '../lib/useViewportSize';
import { useEditorStore } from '../model/editor.store';
import { ElementShape } from './ElementShape';
import { ShapeRenderer } from './ShapeRenderer';

/**
 * Холст-шелл: связывает Konva Stage со сторами. Рендерит фигуры ИЗ document-стора
 * (стор — источник правды, Konva отражает его, не наоборот) и накладывает превью
 * текущего черновика поверх.
 *
 * Подписки точечные:
 *  - elementIds (shallow) — список перерисовывается только при добавлении/удалении
 *    фигуры или смене порядка, а не при правке одной фигуры;
 *  - сам элемент тащит уже ShapeRenderer по своему id.
 */
export function CanvasStage(): ReactElement {
  const { width, height } = useViewportSize();
  const { cursor, handlers } = useCanvasInteraction();

  const viewport = useEditorStore((state) => state.viewport);
  const draft = useEditorStore((state) => state.draft);
  const selectedTool = useEditorStore((state) => state.selectedTool);
  const setTool = useEditorStore((state) => state.setTool);
  const elementIds = useDocumentStore(useShallow((state) => state.elementIds));

  return (
    <>
      <div className="fixed inset-0 bg-canvas" style={{ cursor }}>
        <Stage
          width={width}
          height={height}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          x={viewport.x}
          y={viewport.y}
          {...handlers}
        >
          <Layer>
            {elementIds.map((id) => (
              <ShapeRenderer key={id} id={id} />
            ))}
            {draft && <ElementShape element={draft} />}
          </Layer>
        </Stage>
      </div>
      <Toolbar selectedTool={selectedTool} onSelectTool={setTool} />
    </>
  );
}
