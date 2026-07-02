import type Konva from 'konva';
import type { Node } from 'konva/lib/Node';
import { type ReactElement, useCallback, useEffect, useRef } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';

import { useDocumentStore } from '@/entities/canvas-element';
import { Toolbar } from '@/features/toolbar';

import { useCanvasHotkeys } from '../lib/useCanvasHotkeys';
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

  const transformerRef = useRef<Konva.Transformer | null>(null);
  // Реестр живых Konva-узлов по id. Ref (не state): наполняется из ref-колбэков
  // в фазе коммита и не должен триггерить рендер.
  const nodeMap = useRef(new Map<string, Node>());
  // Кэш ref-колбэков: стабильная функция на id, иначе ссылка менялась бы каждый
  // рендер и Konva дёргала бы detach/attach узла впустую.
  const refCallbacks = useRef(new Map<string, (node: Node | null) => void>());

  const registerNode = useCallback((id: string): ((node: Node | null) => void) => {
    const cached = refCallbacks.current.get(id);
    if (cached) return cached;

    const callback = (node: Node | null): void => {
      if (node) {
        nodeMap.current.set(id, node);
        return;
      }
      // node === null — узел размонтирован (фигуру удалили). Колбэк стабилен, так
      // что null приходит только на анмаунт: чистим оба реестра, чтобы не текли.
      nodeMap.current.delete(id);
      refCallbacks.current.delete(id);
    };
    refCallbacks.current.set(id, callback);
    return callback;
  }, []);

  // Доступ к Konva-узлу по id для оркестратора: он программно стартует drag
  // (node.startDrag()) по тому же ручному hit-тесту, что рисует курсор — так drag
  // срабатывает ровно там, где показан курсор «move», а не по точечному hit Konva.
  const getNode = useCallback((id: string): Node | null => nodeMap.current.get(id) ?? null, []);

  const { cursor, handlers } = useCanvasInteraction({ getNode });
  // Клавиатурный ввод холста (Delete/Backspace → удаление выделения). Отдельный
  // window-listener, поэтому Stage-фокус не нужен.
  useCanvasHotkeys();

  const viewport = useEditorStore((state) => state.viewport);
  const draft = useEditorStore((state) => state.draft);
  const selectedTool = useEditorStore((state) => state.selectedTool);
  const setTool = useEditorStore((state) => state.setTool);
  const selectedElementIds = useEditorStore(useShallow((state) => state.selectedElementIds));
  const elementIds = useDocumentStore(useShallow((state) => state.elementIds));

  // Привязываем Transformer к выделенным узлам. Он слушает их drag и рисует рамку,
  // следуя за фигурой во время переноса — поэтому индикатор не отстаёт, хотя стор
  // обновится лишь на onDragEnd. elementIds в зависимостях — переприкрепиться после
  // перемонтирования при добавлении/удалении фигур.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const nodes = selectedElementIds
      .map((id) => nodeMap.current.get(id))
      .filter((node): node is Node => node != null);

    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedElementIds, elementIds]);

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
              <ShapeRenderer key={id} id={id} shapeRef={registerNode(id)} />
            ))}
            {draft && <ElementShape element={draft} />}
            {/* Только рамка: ресайз/поворот/ручки выключены (этап 1 их не делает). */}
            <Transformer
              ref={transformerRef}
              resizeEnabled={false}
              rotateEnabled={false}
              enabledAnchors={[]}
              borderStroke="#c2613d"
              borderStrokeWidth={1.5}
              borderDash={[4, 4]}
            />
          </Layer>
        </Stage>
      </div>
      <Toolbar selectedTool={selectedTool} onSelectTool={setTool} />
    </>
  );
}
