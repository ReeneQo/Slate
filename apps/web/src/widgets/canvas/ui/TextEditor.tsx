import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useDocumentStore } from '@/entities/canvas-element';
import { canvasToScreen } from '@/shared/lib/viewport';

import { resolveFontFamily, TEXT_LINE_HEIGHT, TEXT_PADDING } from '../lib/textMetrics';
import { type TextEditorState, useTextEditorState } from '../lib/useTextEditorState';
import { useEditorStore } from '../model/editor.store';

/** Минимальная ширина textarea (пустой текст) — оставляет место под каретку, не схлопывается в 0. */
const MIN_WIDTH_PX = 2;
/** Запас справа от последнего символа — под сам курсор ввода, иначе он обрезался бы по краю. */
const CARET_ALLOWANCE_PX = 4;

/**
 * HTML-оверлей ввода/редактирования текста (SLT-61). Единственный компонент во всей задаче, для
 * которого нет Konva-аналога: текстовый ввод в браузере — это DOM textarea, а не canvas-примитив,
 * поэтому оверлей рендерится СНАРУЖИ Stage, поверх него, как обычный позиционированный DOM-узел
 * (см. точку монтирования в CanvasStage.tsx — сиблинг `<Stage>` внутри `div.fixed.inset-0`).
 *
 * Тонкая обёртка: решает МОНТИРОВАТЬ ли сессию и с каким `key`. Сама сессия — в
 * TextEditorSession, ремонтируемой на каждую новую edit-цель (см. её докстринг про то, почему
 * это не эффект).
 */
export function TextEditor(): ReactElement | null {
  const state = useTextEditorState();
  const editingTextId = useEditorStore((s) => s.editingTextId);

  if (!state.isOpen) return null;

  // key = editingTextId для edit-сессий (новая edit-цель — новый key — свежий монтаж) и константа
  // для create (там текст всегда идёт напрямую из draft/state.text, без локального буфера —
  // ремонт между create-сессиями не нужен, см. TextEditorSession).
  return <TextEditorSession key={editingTextId ?? 'create'} state={state} />;
}

interface TextEditorSessionProps {
  state: TextEditorState;
}

/**
 * Одна сессия оверлея — от открытия до коммита/отмены. Ремонтируется (не переиспользуется через
 * эффект-ресинк) при смене edit-цели — это НЕ стилистический выбор, а обход реального бага
 * React-таймингов: `useState('')` + `useEffect(() => setLocalText(...), [editingTextId])` кажется
 * рабочим, но на самом деле ломает «фокус в конце» при ре-редактировании —
 *
 *   1. Рендер N (только что открыли edit): localText ещё СТАРЫЙ ('' на первый раз), поэтому
 *      textarea коммитится в DOM с value="".
 *   2. Passive-эффекты рендера N выполняются В ОДНОМ проходе: сид-эффект зовёт setLocalText(text)
 *      (только ПЛАНИРУЕТ рендер N+1, DOM ещё не поменялся) — а автофокус-эффект тут же читает
 *      `el.value.length`, которое ВСЁ ЕЩЁ 0, и ставит курсор в НАЧАЛО, а не в конец.
 *   3. Рендер N+1 обновляет DOM value на реальный текст, но автофокус-эффект по [state.isOpen]
 *      второй раз не срабатывает (isOpen не менялся) — курсор так и остаётся в начале.
 *
 * Ремонт через `key` в TextEditor убирает эту гонку: `useState(() => state.text)` — lazy-
 * initializer, значение верно уже на ПЕРВОМ рендере свежего монтажа, поэтому автофокус-эффект
 * (запускается на mount) читает уже правильный `el.value`.
 */
function TextEditorSession({ state }: TextEditorSessionProps): ReactElement {
  const viewport = useEditorStore((s) => s.viewport);
  const draft = useEditorStore((s) => s.draft);
  const setDraft = useEditorStore((s) => s.setDraft);
  const setTool = useEditorStore((s) => s.setTool);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const clearEditingTextId = useEditorStore((s) => s.clearEditingTextId);
  const commitElement = useDocumentStore((s) => s.commitElement);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const deleteElements = useDocumentStore((s) => s.deleteElements);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Буфер edit-режима: правки НЕ уходят в document-store на каждую клавишу (это вызвало бы
  // updateElement → emitChange → autosave-запрос на каждый символ). Копится локально, коммитится
  // ЦЕЛИКОМ на blur/Escape. create-режим так не делает — там ввод уже идёт через draft в
  // editor-сторе (эфемерное состояние, autosave его не видит, см. document.store.ts). Lazy-
  // initializer — не пустая строка: см. докстринг компонента про баг с курсором.
  const [localText, setLocalText] = useState(() => state.text);

  // Автофокус при монтировании сессии + курсор в конец (create: пустой текст, конец == начало;
  // edit: конец существующего текста, Р6). Пустой deps — ровно один раз на mount этой сессии.
  // К этому моменту el.value УЖЕ верный (см. докстринг компонента) — в отличие от эффект-ресинка,
  // здесь нет рендера с устаревшим значением, который отравил бы вычисление `end`.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const currentText = state.mode === 'create' ? state.text : localText;
  const fontSizePx = state.fontSize * viewport.scale;
  const fontFamilyCss = resolveFontFamily(state.fontFamily);

  // Авторазмер (Р8): высота — по scrollHeight (единственный надёжный способ у textarea).
  // Ширина — измеряем текст тем же путём, которым Konva сама считает ширину Text без явного
  // width (canvas 2D text metrics), а не заводим фиксированную ширину с word-wrap — перенос
  // должен остаться только по `\n`, как и у Konva.Text без width. Без deps-массива: должно
  // пересчитываться на КАЖДЫЙ рендер (после любого изменения текста/шрифта/scale).
  // useLayoutEffect, НЕ useEffect: мутирует layout (style.height/width) ДО отрисовки кадра
  // браузером — иначе на каждой клавише/открытии был бы виден один кадр со старым размером
  // textarea перед тем, как эффект его поправит (тот же класс «прыжка», что и у коммита, просто
  // на вводе).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;

    const canvas = measureCanvasRef.current ?? document.createElement('canvas');
    measureCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.font = `${fontSizePx}px ${fontFamilyCss}`;
    const lines = currentText.length > 0 ? currentText.split('\n') : [''];
    const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    el.style.width = `${Math.max(widest, MIN_WIDTH_PX) + CARET_ALLOWANCE_PX}px`;
  });

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value;
    if (state.mode === 'create') {
      if (!draft || draft.type !== 'text') return;
      setDraft({ ...draft, data: { ...draft.data, text: value } });
      return;
    }
    setLocalText(value);
  };

  // Коммит (Р6): blur ИЛИ Escape ведут сюда одним путём (Escape просто снимает фокус, что и
  // порождает blur) — единственная точка, где решается «сохранить или удалить пустое».
  const commit = (): void => {
    const trimmed = currentText.trim();

    if (state.mode === 'create') {
      if (draft && draft.type === 'text') {
        if (trimmed.length > 0) commitElement(draft);
        // Пустой черновик просто отбрасывается — commitElement не зовём.
      }
      setDraft(null);
      setTool('select');
      return;
    }

    // edit
    if (editingTextId === null) return;
    if (trimmed.length > 0) {
      updateElement(editingTextId, {
        data: { text: currentText, fontSize: state.fontSize, fontFamily: state.fontFamily },
      });
    } else {
      // Стёрли в пустоту при ре-редактировании — элемент удаляется, а не остаётся пустым.
      deleteElements([editingTextId]);
    }
    clearEditingTextId();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Escape') return;
    // Enter специально НЕ перехватываем: нативное поведение textarea уже вставляет \n и не
    // «сабмитит» — ровно перенос строки, который требует Р6, без единой лишней строчки кода.
    event.preventDefault();
    // blur() запускает handleBlur → commit() — тот же путь, что и клик вне оверлея, единственная
    // точка коммита, не дублируем логику.
    textareaRef.current?.blur();
  };

  const screen = canvasToScreen({ x: state.x, y: state.y }, viewport);

  return (
    <textarea
      ref={textareaRef}
      value={currentText}
      onChange={handleChange}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      spellCheck={false}
      rows={1}
      style={{
        position: 'absolute',
        left: screen.x,
        top: screen.y,
        // font-size*scale (SLT-61 Б): Konva сам масштабирует canvas-координаты через Stage
        // scaleX/scaleY, а textarea живёт в экранных px вне Stage — обязана домножить сама.
        fontSize: `${fontSizePx}px`,
        fontFamily: fontFamilyCss,
        lineHeight: TEXT_LINE_HEIGHT,
        padding: `${TEXT_PADDING}px`,
        color: state.stroke,
        margin: 0,
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        whiteSpace: 'pre',
        // НЕ word-wrap в фиксированной ширине (Р5-A) — ширина сама растёт под контент (см. эффект
        // авторазмера), перенос только по явному \n, который уже есть в value.
      }}
    />
  );
}
