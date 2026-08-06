import type { ReactElement } from 'react';
import { Group, Label, Layer, Path, Tag, Text } from 'react-konva';

import { useRealtimeStore } from '@/features/realtime-presence';
import { colorForUserId } from '@/shared/lib/color';

/** Простая стрелка-указатель (path в локальных единицах узла, до масштабирования группы). */
const POINTER_PATH = 'M0 0 L0 14 L4 11 L6.5 16.5 L9 15.5 L6.5 10 L11 10 Z';

interface RemoteCursorsLayerProps {
  /** Текущий зум холста — компенсируем им курсор/подпись, чтобы их размер на экране не плыл. */
  scale: number;
}

/**
 * Отдельный Konva-слой поверх слоя элементов — курсоры участников НЕ часть документа (SLT-37).
 *
 * Курсоры кладутся тем же приёмом, что и элементы (ElementShape): узел позиционируется в МИРОВЫХ
 * координатах внутри уже трансформированного Stage (см. CanvasStage — scaleX/scaleY/x/y), поэтому
 * при пане/зуме своего холста чужие курсоры едут вместе с полотном сами, без ручной конверсии
 * мир→экран здесь. Инвертированный scale на самой Group — только чтобы указатель и подпись не
 * увеличивались/уменьшались вместе с зумом (тот же приём, что и hit-зона в ElementShape).
 *
 * `listening={false}` на Layer: слой чисто декоративный и не должен перехватывать мышь у
 * pan/zoom/рисования на нижнем слое.
 */
export function RemoteCursorsLayer({ scale }: RemoteCursorsLayerProps): ReactElement {
  const cursors = useRealtimeStore((state) => state.cursors);
  const inverseScale = 1 / scale;

  return (
    <Layer listening={false}>
      {Object.values(cursors).map((cursor) => {
        const color = colorForUserId(cursor.userId);
        return (
          <Group
            key={cursor.userId}
            x={cursor.x}
            y={cursor.y}
            scaleX={inverseScale}
            scaleY={inverseScale}
          >
            <Path data={POINTER_PATH} fill={color} stroke="#ffffff" strokeWidth={1} />
            <Label x={14} y={14}>
              <Tag fill={color} cornerRadius={4} />
              <Text text={cursor.displayName} fontSize={12} padding={4} fill="#ffffff" />
            </Label>
          </Group>
        );
      })}
    </Layer>
  );
}
