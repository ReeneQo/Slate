import type Konva from 'konva';
import type { Node } from 'konva/lib/Node';
import { type ReactElement, useCallback, useEffect, useRef } from 'react';
import { Layer, Rect, Stage, Transformer } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';

import { useDocumentStore } from '@/entities/canvas-element';
import { Toolbar } from '@/features/toolbar';

import { useCanvasHotkeys } from '../lib/useCanvasHotkeys';
import { useCanvasInteraction } from '../lib/useCanvasInteraction';
import { useCursorBroadcast } from '../lib/useCursorBroadcast';
import { useTransform } from '../lib/useTransform';
import { useViewportSize } from '../lib/useViewportSize';
import { useEditorStore } from '../model/editor.store';
import { ElementShape } from './ElementShape';
import { RemoteCursorsLayer } from './RemoteCursorsLayer';
import { ShapeRenderer } from './ShapeRenderer';
import { TextEditor } from './TextEditor';

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

  const { cursor, handlers, isPanMode } = useCanvasInteraction(nodeMap);
  // Клавиатурный ввод холста (Delete/Backspace → удаление выделения). Отдельный
  // window-listener, поэтому Stage-фокус не нужен.
  useCanvasHotkeys();
  // Ретрансляция СВОЕГО курсора остальным участникам (SLT-37) — независимый от useCanvasInteraction
  // поток, вешается на обёртку Stage нативными onMouseMove/onMouseLeave (не на Konva-обработчики).
  const { onPointerMove, onPointerLeave } = useCursorBroadcast();

  const viewport = useEditorStore((state) => state.viewport);
  const draft = useEditorStore((state) => state.draft);
  const selectedTool = useEditorStore((state) => state.selectedTool);
  const setTool = useEditorStore((state) => state.setTool);
  const selectedElementIds = useEditorStore(useShallow((state) => state.selectedElementIds));
  const canEdit = useEditorStore((state) => state.canEdit);
  const editingTextId = useEditorStore((state) => state.editingTextId);
  const marqueeRect = useEditorStore((state) => state.marqueeRect);
  const elementIds = useDocumentStore(useShallow((state) => state.elementIds));

  // Фигуры таскаются нативным Konva draggable, но только в select-режиме, вне pan и при праве на
  // мутацию (SLT-43, роль-гейт): viewer выделяет (см. useSelection — не гейтится), но не тащит.
  const shapesDraggable = selectedTool === 'select' && !isPanMode && canEdit;

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

  const { enabledAnchors, keepRatio, boundBoxFunc, handleTransformEnd } = useTransform(
    transformerRef,
    selectedElementIds,
  );

  return (
    <>
      <div
        className="fixed inset-0 bg-canvas"
        style={{ cursor }}
        onMouseMove={onPointerMove}
        onMouseLeave={onPointerLeave}
      >
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
            {elementIds
              // Элемент, который ПРЯМО СЕЙЧАС правит текстовый оверлей (SLT-61), не рисуем здесь —
              // иначе под оверлеем был бы виден committed Konva.Text со СТАРЫМ текстом, пока
              // textarea поверх него показывает новый ввод (два разных текста друг на друге).
              // Оверлей — единственный видимый источник правды на время редактирования.
              .filter((id) => id !== editingTextId)
              .map((id) => (
                <ShapeRenderer
                  key={id}
                  id={id}
                  shapeRef={registerNode(id)}
                  draggable={shapesDraggable}
                  scale={viewport.scale}
                />
              ))}
            {/* text-черновик не рисуем как Konva-превью — тот же аргумент, что и выше: оверлей уже
                показывает вводимый текст, дублировать его в canvas не нужно (и второй экземпляр
                неизбежно чуть разъедется по суб-пиксельному рендеру с DOM-текстом). */}
            {draft && draft.type !== 'text' && (
              <ElementShape element={draft} scale={viewport.scale} />
            )}
            {/* Marquee-рамка (SLT-64) — эфемерный визуал по аналогии с draft-превью выше, но не
                фигура: listening=false, чтобы не перехватывать hit-test у фигур под ней. */}
            {marqueeRect && (
              <Rect
                x={marqueeRect.x}
                y={marqueeRect.y}
                width={marqueeRect.width}
                height={marqueeRect.height}
                stroke="#c2613d"
                strokeWidth={1}
                dash={[4, 4]}
                fill="rgba(194, 97, 61, 0.08)"
                listening={false}
              />
            )}
            {/* Ресайз (SLT-62) и поворот (SLT-63) включены вместе — handleTransformEnd запекает оба
                за один onTransformEnd. Ручки/keepRatio переключаются по типу выделенной фигуры
                (useTransform): text — только углы + пропорционально, остальные — полный набор,
                свободный ресайз. Поворот доступен для ВСЕХ типов, включая text. */}
            <Transformer
              ref={transformerRef}
              resizeEnabled
              rotateEnabled
              enabledAnchors={enabledAnchors}
              keepRatio={keepRatio}
              boundBoxFunc={boundBoxFunc}
              onTransformEnd={handleTransformEnd}
              borderStroke="#c2613d"
              borderStrokeWidth={1.5}
              borderDash={[4, 4]}
            />
          </Layer>
          <RemoteCursorsLayer scale={viewport.scale} />
        </Stage>
        {/* Сиблинг Stage, НЕ внутри него: Konva рендерит canvas, не DOM — HTML textarea обязана
            жить рядом, абсолютно спозиционированной поверх (см. TextEditor.tsx). Идёт ПОСЛЕ
            Stage в DOM-порядке — по умолчанию оказывается выше него по z, без явного z-index. */}
        <TextEditor />
      </div>
      {/* Роль-гейт (SLT-43): viewer не рисует — тулбар инструментов рисования скрыт целиком,
          а не задизейблен по кнопке (единый флаг, не размазанный if по элементам). */}
      {canEdit && <Toolbar selectedTool={selectedTool} onSelectTool={setTool} />}
    </>
  );
}
