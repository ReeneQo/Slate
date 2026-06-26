import type { ReactElement } from 'react';
import { Layer, Rect, Stage } from 'react-konva';

import { useCanvasViewport } from '../lib/useCanvasViewport';
import { useViewportSize } from '../lib/useViewportSize';

const SAMPLE_SHAPE = {
  fill: '#ffffff',
  stroke: '#c2613d',
  shadow: 'rgba(39, 45, 54, 0.18)',
} as const;

const SHAPE_WIDTH = 220;
const SHAPE_HEIGHT = 140;

export function CanvasStage(): ReactElement {
  const { width, height } = useViewportSize();
  const { transform, cursor, handlers } = useCanvasViewport();

  return (
    <div className="fixed inset-0 bg-canvas" style={{ cursor }}>
      <Stage
        width={width}
        height={height}
        scaleX={transform.scale}
        scaleY={transform.scale}
        x={transform.x}
        y={transform.y}
        onWheel={handlers.onWheel}
        onMouseDown={handlers.onMouseDown}
        onMouseMove={handlers.onMouseMove}
        onMouseUp={handlers.onMouseUp}
        onMouseLeave={handlers.onMouseLeave}
      >
        <Layer>
          <Rect
            x={width / 2 - SHAPE_WIDTH / 2}
            y={height / 2 - SHAPE_HEIGHT / 2}
            width={SHAPE_WIDTH}
            height={SHAPE_HEIGHT}
            cornerRadius={14}
            fill={SAMPLE_SHAPE.fill}
            stroke={SAMPLE_SHAPE.stroke}
            strokeWidth={2}
            shadowColor={SAMPLE_SHAPE.shadow}
            shadowBlur={24}
            shadowOffsetY={8}
            shadowOpacity={1}
          />
        </Layer>
      </Stage>
    </div>
  );
}
