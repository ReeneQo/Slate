import { useEffect } from 'react';

import { useDocumentStore } from '@/entities/canvas-element';

import { useEditorStore } from '../model/editor.store';

export type TextEditorMode = 'create' | 'edit';

/**
 * Единая производная точка состояния текстового оверлея (SLT-61). `draft`/`editingTextId` в
 * editor-сторе — это ДВА разных пути («создаю новый» / «правлю существующий»), но потребителю
 * (TextEditor, логика коммита) не нужно знать про эту вилку — им нужен один нормализованный ответ:
 * «оверлей открыт, вот его данные». Разбрасывать `draft?.type === 'text'` и `editingTextId` по
 * JSX означало бы дублировать эту развилку в каждом месте, где она нужна, и однажды забыть один
 * из путей при правке другого.
 */
export interface TextEditorState {
  isOpen: boolean;
  mode: TextEditorMode;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: 'sans' | 'mono';
  /** Цвет текста (= stroke, фиксация Р5). Нужен textarea, чтобы не «мигать» цветом при коммите. */
  stroke: string;
}

const CLOSED: TextEditorState = {
  isOpen: false,
  mode: 'create',
  text: '',
  x: 0,
  y: 0,
  fontSize: 0,
  fontFamily: 'sans',
  stroke: '',
};

export function useTextEditorState(): TextEditorState {
  const draft = useEditorStore((state) => state.draft);
  const editingTextId = useEditorStore((state) => state.editingTextId);
  const clearEditingTextId = useEditorStore((state) => state.clearEditingTextId);
  const editingElement = useDocumentStore((state) =>
    editingTextId !== null ? state.elements[editingTextId] : undefined,
  );

  /**
   * editingTextId указывает на элемент, которого больше нет в document-сторе (удалён локально
   * или чужим ws-клиентом, пока оверлей был открыт, SLT-61 фикс. #5). Закрываем штатно: без этого
   * editingTextId остался бы «залипшим» навсегда — start()/onDblClick воспринимали бы его как
   * «оверлей уже открыт» и блокировали бы любое новое открытие текста.
   */
  useEffect(() => {
    if (editingTextId !== null && (!editingElement || editingElement.type !== 'text')) {
      clearEditingTextId();
    }
  }, [editingTextId, editingElement, clearEditingTextId]);

  if (draft && draft.type === 'text') {
    return {
      isOpen: true,
      mode: 'create',
      text: draft.data.text,
      x: draft.x,
      y: draft.y,
      fontSize: draft.data.fontSize,
      fontFamily: draft.data.fontFamily,
      stroke: draft.stroke,
    };
  }

  if (editingTextId !== null && editingElement && editingElement.type === 'text') {
    return {
      isOpen: true,
      mode: 'edit',
      text: editingElement.data.text,
      x: editingElement.x,
      y: editingElement.y,
      fontSize: editingElement.data.fontSize,
      fontFamily: editingElement.data.fontFamily,
      stroke: editingElement.stroke,
    };
  }

  return CLOSED;
}
