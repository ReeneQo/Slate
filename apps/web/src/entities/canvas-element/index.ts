export { type DocumentStore, type ElementPatch, useDocumentStore } from './model/document.store';
export {
  createDraft,
  DEFAULT_STYLE,
  isCommittable,
  normalizeBounds,
  SCHEMA_VERSION,
  updateDraftGeometry,
} from './model/element';
export type {
  BaseElement,
  CanvasDocument,
  CanvasElement,
  DraftElement,
  ElementType,
  EllipseElement,
  LineElement,
  RectElement,
  ToolType,
} from './model/types';
